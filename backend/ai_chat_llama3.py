import sys
import json
import torch
import os
from transformers import AutoTokenizer, AutoModelForCausalLM
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

# Suppress TensorFlow warnings
os.environ["TF_ENABLE_ONEDNN_OPTS"] = "0"

##########################################################################################
# 1. Model & Device Configuration
##########################################################################################
MODEL_PATH = os.getenv("MODEL_PATH")
if not MODEL_PATH:
    print(json.dumps({"error": "MODEL_PATH not found in .env file."}))
    sys.exit(1)

device = "cuda" if torch.cuda.is_available() else "cpu"
dtype = torch.float16 if torch.cuda.is_available() else torch.float32

# Check if model directory exists
if not os.path.exists(MODEL_PATH):
    print(json.dumps({"error": f"Model path does not exist: {MODEL_PATH}. Please verify the path and ensure the model files are present."}))
    sys.exit(1)

# Load the tokenizer and model
try:
    tokenizer = AutoTokenizer.from_pretrained(MODEL_PATH)
    # Explicitly set pad_token_id if not already set
    if tokenizer.pad_token_id is None:
        tokenizer.pad_token_id = tokenizer.eos_token_id

    model = AutoModelForCausalLM.from_pretrained(
        MODEL_PATH,
        torch_dtype=dtype,
        device_map=device,
        low_cpu_mem_usage=True
    )
    model.eval()
except Exception as e:
    print(json.dumps({"error": f"Failed to load model: {str(e)}"}))
    sys.exit(1)

##########################################################################################
# 2. System Prompt for Krishna Chatbot
##########################################################################################
SYSTEM_PROMPT = """
You are Krishna, an AI model designed to assist agents in an Indian banking call center process. Provide a helpful and generic response to every question asked by the agent.
"""

##########################################################################################
# 3. Chat Response Generation Function
##########################################################################################
def generate_response(user_message: str) -> dict:
    """
    Generate a generic response for the agent's message using DeepSeek-R1-Distill-Qwen-1.5B.
    Returns a dict with the response and escalation flag.
    Adjusted to prevent input echoing and ensure complete responses.
    """
    # Use a clean prompt to avoid echoing the input
    prompt = f"{SYSTEM_PROMPT}\nAgent: {user_message}\nAssistant:"

    try:
        inputs = tokenizer(
            prompt,
            return_tensors="pt",
            truncation=True,
            max_length=512,
            padding=True
        ).to(device)

        with torch.no_grad():
            outputs = model.generate(
                **inputs,
                max_new_tokens=150,  # Increased to ensure complete responses
                do_sample=False,
                temperature=None,
                top_p=None,
                pad_token_id=tokenizer.pad_token_id
            )

        raw_output = tokenizer.decode(outputs[0], skip_special_tokens=True)
        # Extract only the response after "Assistant:" and remove the input
        response_lines = raw_output.split("\nAssistant:")[-1].strip().split("\n")
        response = response_lines[0].strip() if response_lines else ""

        if not response:
            response = "I'm sorry, Krishna is here to help. Please provide more details so I can assist you better."
        elif len(response.split()) > 50:
            response = response[:200] + "..."
        if not response.endswith("."):
            response += "."

        # No specific escalation logic; set escalate to False by default
        is_confused = False

        return {
            "response": response,
            "escalate": is_confused
        }
    except torch.cuda.OutOfMemoryError:
        return {"response": "I'm sorry, Krishna encountered an error. Please try again.", "escalate": True}
    except Exception as e:
        return {"response": "I'm sorry, Krishna encountered an error. Please try again.", "escalate": True}

##########################################################################################
# 4. Entrypoint and Resource Cleanup
##########################################################################################
if __name__ == "__main__":
    try:
        input_data = sys.stdin.read().strip()
        
        if not input_data:
            print(json.dumps({"error": "No input data received."}))
            sys.exit(1)

        data = json.loads(input_data)
        if "message" not in data:
            print(json.dumps({"error": "Input JSON does not contain 'message' key."}))
            sys.exit(1)

        user_message = data["message"]
        response_data = generate_response(user_message)
        print(json.dumps(response_data))

    except json.JSONDecodeError as e:
        print(json.dumps({"error": f"Error parsing input JSON: {str(e)}"}))
        sys.exit(1)
    except Exception as e:
        print(json.dumps({"error": f"Error processing request: {str(e)}"}))
        sys.exit(1)
    finally:
        # Clean up resources
        try:
            del model
            del tokenizer
            if torch.cuda.is_available():
                torch.cuda.empty_cache()
        except Exception:
            pass