"""AI4Bharat IndicLID — text language ID (22 Indic langs + English). MIT license."""

from __future__ import annotations

import logging
import re
from pathlib import Path

import fasttext
import torch
from torch.utils.data import DataLoader, Dataset
from transformers import AutoTokenizer

# Optional pandas only for roman BERT batch path — use lists if unavailable
try:
    import pandas as pd
except ImportError:
    pd = None

logger = logging.getLogger(__name__)


class IndicBERT_Data(Dataset):
    def __init__(self, indices, texts):
        self.x = list(texts)
        self.i = list(indices)

    def __len__(self):
        return len(self.x)

    def __getitem__(self, idx):
        return self.i[idx], self.x[idx]


class IndicLID:
    def __init__(
        self,
        model_dir: Path,
        *,
        bert_tokenizer_path: str | Path | None = None,
        input_threshold: float = 0.5,
        roman_lid_threshold: float = 0.6,
        device: str | None = None,
    ):
        model_dir = Path(model_dir)
        self.device = torch.device(device or ("cuda:0" if torch.cuda.is_available() else "cpu"))

        ftn_path = model_dir / "indiclid-ftn" / "model_baseline_roman.bin"
        ftr_path = model_dir / "indiclid-ftr" / "model_baseline_roman.bin"
        bert_path = model_dir / "indiclid-bert" / "basline_nn_simple.pt"

        for p in (ftn_path, ftr_path, bert_path):
            if not p.is_file():
                raise FileNotFoundError(f"IndicLID weight missing: {p}")

        self.IndicLID_FTN = fasttext.load_model(str(ftn_path))
        self.IndicLID_FTR = fasttext.load_model(str(ftr_path))
        self.IndicLID_BERT = torch.load(str(bert_path), map_location=self.device, weights_only=False)
        self.IndicLID_BERT.eval()

        tok_path = str(bert_tokenizer_path or model_dir / "IndicBERTv2-MLM-only")
        self._bert_tokenizer_available = False
        tok_dir = Path(tok_path)
        if tok_dir.is_dir() and (
            (tok_dir / "tokenizer.json").is_file() or (tok_dir / "vocab.txt").is_file()
        ):
            self.IndicLID_BERT_tokenizer = AutoTokenizer.from_pretrained(tok_path)
            self._bert_tokenizer_available = True
        else:
            self.IndicLID_BERT_tokenizer = None
            logger.warning(
                "IndicBERT tokenizer missing at %s — roman BERT fallback disabled (FTR only)",
                tok_path,
            )

        self.input_threshold = input_threshold
        self.model_threshold = roman_lid_threshold

        self.IndicLID_lang_code_dict_reverse = {
            0: "asm_Latn", 1: "ben_Latn", 2: "brx_Latn", 3: "guj_Latn", 4: "hin_Latn",
            5: "kan_Latn", 6: "kas_Latn", 7: "kok_Latn", 8: "mai_Latn", 9: "mal_Latn",
            10: "mni_Latn", 11: "mar_Latn", 12: "nep_Latn", 13: "ori_Latn", 14: "pan_Latn",
            15: "san_Latn", 16: "snd_Latn", 17: "tam_Latn", 18: "tel_Latn", 19: "urd_Latn",
            20: "eng_Latn", 21: "other", 22: "asm_Beng", 23: "ben_Beng", 24: "brx_Deva",
            25: "doi_Deva", 26: "guj_Gujr", 27: "hin_Deva", 28: "kan_Knda", 29: "kas_Arab",
            30: "kas_Deva", 31: "kok_Deva", 32: "mai_Deva", 33: "mal_Mlym", 34: "mni_Beng",
            35: "mni_Meti", 36: "mar_Deva", 37: "nep_Deva", 38: "ori_Orya", 39: "pan_Guru",
            40: "san_Deva", 41: "sat_Olch", 42: "snd_Arab", 43: "tam_Tamil", 44: "tel_Telu",
            45: "urd_Arab",
        }

    def char_percent_check(self, text: str) -> float:
        input_len = len(list(text))
        special_char_pattern = re.compile(r"[@_!#$%^&*()<>?/\\|}{~:]")
        special_chars = len(special_char_pattern.findall(text))
        spaces = len(re.findall(r"\s", text))
        newlines = len(re.findall(r"\n", text))
        total_chars = input_len - (special_chars + spaces + newlines)
        en_pattern = re.compile(r"[a-zA-Z0-9]")
        en_chars = len(en_pattern.findall(text))
        if total_chars == 0:
            return 0.0
        return en_chars / total_chars

    def native_inference(self, input_list, output_dict):
        if not input_list:
            return output_dict
        texts = [line[1] for line in input_list]
        preds = self.IndicLID_FTN.predict(texts)
        for inp, pred_label, pred_score in zip(input_list, preds[0], preds[1]):
            output_dict[inp[0]] = (inp[1], pred_label[0][9:], pred_score[0], "IndicLID-FTN")
        return output_dict

    def IndicBERT_roman_inference(self, bert_inputs, output_dict, batch_size):
        if not bert_inputs or not self._bert_tokenizer_available:
            for inp in bert_inputs:
                output_dict[inp[0]] = (inp[1], "other", 0.0, "IndicLID-BERT-skipped")
            return output_dict
        indices = [x[0] for x in bert_inputs]
        texts = [x[1] for x in bert_inputs]
        loader = DataLoader(IndicBERT_Data(indices, texts), batch_size=batch_size, shuffle=False)
        with torch.no_grad():
            for batch_indices, batch_inputs in loader:
                enc = self.IndicLID_BERT_tokenizer(
                    batch_inputs,
                    return_tensors="pt",
                    padding=True,
                    truncation=True,
                    max_length=512,
                )
                enc = {k: v.to(self.device) for k, v in enc.items()}
                out = self.IndicLID_BERT(
                    enc["input_ids"],
                    token_type_ids=enc.get("token_type_ids"),
                    attention_mask=enc["attention_mask"],
                )
                _, predicted = torch.max(out.logits, 1)
                for index, inp, pred_label, logit in zip(
                    batch_indices, batch_inputs, predicted, out.logits
                ):
                    output_dict[int(index)] = (
                        inp,
                        self.IndicLID_lang_code_dict_reverse[pred_label.item()],
                        logit[pred_label.item()].item(),
                        "IndicLID-BERT",
                    )
        return output_dict

    def roman_inference(self, input_list, output_dict, batch_size):
        if not input_list:
            return output_dict
        texts = [line[1] for line in input_list]
        preds = self.IndicLID_FTR.predict(texts)
        bert_inputs = []
        for inp, pred_label, pred_score in zip(input_list, preds[0], preds[1]):
            if pred_score[0] > self.model_threshold or not self._bert_tokenizer_available:
                output_dict[inp[0]] = (inp[1], pred_label[0][9:], pred_score[0], "IndicLID-FTR")
            else:
                bert_inputs.append(inp)
        return self.IndicBERT_roman_inference(bert_inputs, output_dict, batch_size)

    def batch_predict(self, input_list: list[str], batch_size: int = 8) -> list[tuple]:
        output_dict: dict = {}
        roman_inputs = []
        native_inputs = []
        for index, text in enumerate(input_list):
            if self.char_percent_check(text) > self.input_threshold:
                roman_inputs.append((index, text))
            else:
                native_inputs.append((index, text))
        output_dict = self.native_inference(native_inputs, output_dict)
        output_dict = self.roman_inference(roman_inputs, output_dict, batch_size)
        keys = sorted(output_dict.keys())
        return [output_dict[k] for k in keys]

    def predict(self, text: str) -> tuple[str, float, str]:
        """Return (indiclid_code, score, engine)."""
        results = self.batch_predict([text], 1)
        if not results:
            return "other", 0.0, "none"
        _text, code, score, engine = results[0]
        return code, float(score), engine
