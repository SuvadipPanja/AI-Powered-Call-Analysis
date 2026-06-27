import os, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from dotenv import load_dotenv
load_dotenv()
from db import connect
with connect() as c:
    cur = c.cursor()
    cur.execute("SELECT Username, SecurityQuestionType, SecurityQuestionAnswer FROM Users WHERE UserID='admin' OR Username='admin'")
    for r in cur.fetchall():
        print(r)
