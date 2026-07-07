"""Word dictionaries for word-match language detection (12 Indian call-center languages).

Used by wordmatch_lid.py: the first agent/customer chunks are transcribed by
Whisper (auto mode), then each language is scored by counting matches of these
words in the transcript. Native-script words match when Whisper writes the
language's own script; roman words match when Whisper romanizes to Latin.

PSU-banking + general conversation vocabulary. Each language has:
  native  — words in the language's own script (function words + banking terms)
  roman   — romanized forms seen when Whisper outputs Latin script
  script  — Unicode script key(s) from language_worker.SCRIPT_RES

NEUTRAL_TERMS never count for any language (English banking loanwords used by
every Indian speaker — they carry zero language information in code-mixed calls).
"""

from __future__ import annotations

# English banking/courtesy loanwords used by speakers of EVERY Indian language.
# These must not count as evidence for any language (including English).
NEUTRAL_TERMS: frozenset[str] = frozenset("""
account balance bank card loan emi otp atm upi kyc ifsc neft rtgs imps
number mobile phone customer branch cheque check credit debit statement
transaction transfer deposit passbook pin cvv sir madam hello hi ok okay
yes no id sms call app online offline net internet form status active
minimum maximum limit charge charges fees due date time aadhaar pan
""".split())


# ---------------------------------------------------------------------------
# ENGLISH — decided by FUNCTION words (the/is/are/please/how...), never by
# banking nouns, because Hinglish speakers say "account balance" constantly.
# ---------------------------------------------------------------------------
ENGLISH_FUNCTION_WORDS: frozenset[str] = frozenset("""
a an the this that these those is are was were be been being am
i you he she it we they me him her us them my your his its our their mine yours
and or but so because if then than as at by for from in into of off on onto out
over to up with within without not do does did done doing have has had having
will would shall should can could may might must
what when where why who whom which how here there now today tomorrow yesterday
good morning afternoon evening night thank thanks please sorry welcome
speak speaking talk tell told say said ask asked help assist assistance support
service amount money payment pay paid banking interest rate name confirm verify
verification detail details information provide give registered address email
issue problem query complaint request update checking block blocked
minute second hour day week month year hold wait moment
one two three four five six seven eight nine ten zero hundred thousand
understand understood know knew want need like get got make made take taken
come came go going about after again all also any before between both
""".split())


LANGUAGE_WORDS: dict[str, dict] = {
    # =======================================================================
    "Hindi": {
        "script": "devanagari",
        "native": frozenset("""
है हैं हूँ हूं था थी थे और आप आपका आपकी आपके आपको मैं मेरा मेरी मेरे हम हमारा हमें
यह वह इस उस ये वो क्या कैसे कहाँ कहां कब क्यों कौन किसका नहीं हाँ हां जी ठीक अच्छा
करना करें करेंगे किया कीजिए कीजिये करता करती बताइए बताइये बताएं बतायें सुनिए सुनिये
देखिए देखिये चाहिए होगा होगी होंगे सकता सकती सकते रहा रही रहे गया गयी गए
धन्यवाद नमस्ते नमस्कार कृपया शुक्रिया माफ़ माफ कीजिएगा स्वागत
पैसा पैसे रुपया रुपये रकम राशि खाता खाते बचत चालू शाखा ऋण कर्ज किस्त ब्याज
लेनदेन जमा निकासी सुविधा जानकारी समस्या शिकायत ग्राहक सेवा मदद सहायता
आवेदन प्रक्रिया दस्तावेज़ दस्तावेज सत्यापन पंजीकृत पंजीकरण
""".split()),
        "roman": frozenset("""
aap aapka aapki aapke aapko main mera meri mere hum hamara hamein
kya kaise kahan kab kyon kaun nahi nahin haan han ji theek thik accha achha
karna karen karenge kiya kijiye karta karti bataiye bataye batayen suniye sunie
dekhiye chahiye hoga hogi honge sakta sakti sakte raha rahi rahe gaya gayi
dhanyavad dhanyawad namaste namaskar kripya shukriya maaf swagat
paisa paise rupaya rupaye rakam rashi khata khate bachat chalu shakha
rin karz kist byaj len-den lenden jama nikasi suvidha jankari jaankari
samasya shikayat grahak seva madad sahayata avedan prakriya
dastavez satyapan panjikrit hoon hain hai tha thi the
""".split()),
    },
    # =======================================================================
    "Marathi": {
        "script": "devanagari",
        "native": frozenset("""
आहे आहेत आहात नाही मी माझा माझी माझे आम्ही आमचा तुम्ही तुमचा तुमची तुमचे आपण
हा ही हे तो ती ते कसा कशी कसे काय कुठे केव्हा कधी का कोण होय हो नको ठीक बरं बरे
करा करतो करते करायचं बोला सांगा ऐका पहा बघा पाहिजे हवं हवे होईल शकता शकतो शकते
धन्यवाद नमस्कार कृपया क्षमा आभारी स्वागत
पैसे रुपये रक्कम खाते बचत चालू शाखा कर्ज हप्ता व्याज
व्यवहार जमा सुविधा माहिती समस्या तक्रार ग्राहक सेवा मदत साहाय्य
अर्ज प्रक्रिया कागदपत्र पडताळणी नोंदणीकृत नोंदणी
""".split()),
        "roman": frozenset("""
aahe aahet aahat nahi mi mazha mazhi mazhe amhi amcha tumhi tumcha tumchi tumche
aapan kasa kashi kase kay kuthe kevha kadhi ka kon hoy ho nako bara bare
kara karto karte karaycha bola sanga aika paha bagha pahije hava have hoil
shakta shakto shakte dhanyavad namaskar krupaya kshama aabhari swagat
paise rupye rakkam khate bachat chalu shakha karja hapta vyaj
vyavhar jama suvidha mahiti samasya takrar grahak seva madat sahayya
arj prakriya kagadpatra padtalni nondanikrut
""".split()),
    },
    # =======================================================================
    "Bengali": {
        "script": "bengali",
        "native": frozenset("""
আমি আমার আমরা আমাদের আপনি আপনার আপনারা আপনাকে আছে আছেন আছি ছিল ছিলেন
এই সেই এটা সেটা কেমন কি কী কোথায় কখন কেন কে কার না হ্যাঁ জি ঠিক আচ্ছা ভালো
করুন করবেন করছি করেছি করতে বলুন বলবেন বলছি শুনুন দেখুন জানুন জানাবেন
চাই চান হবে হয়েছে পারেন পারি পারবেন লাগবে দিন দেবেন নিন
ধন্যবাদ নমস্কার দয়া স্বাগতম মাফ ক্ষমা
টাকা পয়সা পরিমাণ খাতা সঞ্চয় চলতি শাখা ঋণ কিস্তি সুদ
লেনদেন জমা তোলা সুবিধা তথ্য সমস্যা অভিযোগ গ্রাহক সেবা সাহায্য
আবেদন প্রক্রিয়া নথি যাচাই নিবন্ধিত নিবন্ধন
""".split()),
        "roman": frozenset("""
ami amar amra amader apni apnar apnara apnake ache achen achi chilo chilen
ei sei eta seta kemon keman ki kothay kokhon keno ke kar na hyan ji thik
accha bhalo korun korben korchi korechi korte bolun bolben bolchi shunun
sunun dekhun janun janaben chai chan hobe hoyeche paren pari parben lagbe
din deben nin dhonnobad dhanyabad nomoshkar doya swagatam maf khoma
taka poysa poriman khata sanchay chalti shakha rin kisti sud
lenden joma tola subidha tothyo somossa ovijog grahok seba sahajjo
abedan prokriya nothi jachai nibondhito
""".split()),
    },
    # =======================================================================
    # Assamese shares the Bengali script BUT uses ৰ (U+09F0) and ৱ (U+09F1),
    # which standard Bengali never uses — a deterministic marker.
    "Assamese": {
        "script": "bengali",
        "special_chars": ("ৰ", "ৱ"),
        "native": frozenset("""
মই মোৰ আমি আমাৰ আপুনি আপোনাৰ আপোনাক তেওঁ আছে আছোঁ আছিল
এই সেই কেনে কি ক'ত কেতিয়া কিয় কোন নহয় হয় ঠিক ভাল
কৰক কৰিব কৰিছোঁ কওক ক'ব শুনক চাওক জানক লাগে লাগিব হ'ব পাৰে পাৰিম দিয়ক ল'ব
ধন্যবাদ নমস্কাৰ অনুগ্ৰহ স্বাগতম ক্ষমা
টকা পৰিমাণ খাতা সঞ্চয় চলিত শাখা ঋণ কিস্তি সুত
লেনদেন জমা সুবিধা তথ্য সমস্যা অভিযোগ গ্ৰাহক সেৱা সহায়
আবেদন প্ৰক্ৰিয়া নথি নিবন্ধিত
""".split()),
        "roman": frozenset("""
moi mor ami amar apuni aponar aponak teu ase asu asil
ei sei kene ki kot ketia kiyo kun nohoi hoi thik bhal
korok korib korisu kuwok kobo xunok saok janok lage lagibo hobo pare parim
diok lobo dhonyobad namaskar anugroh swagatam khyoma
toka poriman khata sanchay solit sakha rin kisti xut
lenden joma subidha tothyo xomoisya obhijug grahok sewa xohay
abedan prokriya nothi nibondhito
""".split()),
    },
    # =======================================================================
    "Tamil": {
        "script": "tamil",
        "native": frozenset("""
நான் என் எனது எனக்கு நாங்கள் எங்கள் நீங்கள் உங்கள் உங்களுக்கு அவர் அவர்கள்
இது அது இந்த அந்த இருக்கு இருக்கிறது இருக்கிறீர்கள் இல்லை ஆமாம் ஆம் சரி நல்லது
எப்படி என்ன எங்கே எப்போது ஏன் யார் எது
செய்யுங்கள் செய்கிறேன் சொல்லுங்கள் சொல்கிறேன் கேளுங்கள் பாருங்கள் தெரியுமா
வேண்டும் முடியும் முடியாது கொடுங்கள் எடுங்கள் வாருங்கள்
நன்றி வணக்கம் தயவுசெய்து மன்னிக்கவும் வரவேற்கிறோம்
பணம் ரூபாய் தொகை கணக்கு சேமிப்பு நடப்பு கிளை கடன் தவணை வட்டி
பரிவர்த்தனை வைப்பு எடுப்பு வசதி தகவல் பிரச்சனை புகார்
வாடிக்கையாளர் சேவை உதவி விண்ணப்பம் செயல்முறை ஆவணம் சரிபார்ப்பு பதிவு
""".split()),
        "roman": frozenset("""
naan en enathu enakku naangal engal neenga neengal ungal ungalukku avar avargal
ithu athu intha antha irukku irukkirathu irukkireergal illai aamam aam sari
nallathu eppadi enna enge eppothu yen yaar ethu
seyyungal seigiren sollungal solgiren kelungal parungal theriyuma
vendum mudiyum mudiyathu kodungal edungal vaarungal
nandri vanakkam thayavuseithu mannikkavum varaverkirom
panam rupai thogai kanakku semippu nadappu kilai kadan thavanai vatti
parivarthanai vaippu eduppu vasathi thagaval pirachanai pugar
vadikkaiyalar sevai udhavi vinnappam seyalmurai aavanam saripaarppu pathivu
""".split()),
    },
    # =======================================================================
    "Telugu": {
        "script": "telugu",
        "native": frozenset("""
నేను నా నాకు మేము మా మీరు మీ మీకు అతను వారు
ఇది అది ఈ ఆ ఉంది ఉన్నారు ఉన్నాను లేదు అవును సరే మంచిది
ఎలా ఏమి ఏంటి ఎక్కడ ఎప్పుడు ఎందుకు ఎవరు ఏది
చేయండి చేస్తాను చెప్పండి చెబుతాను వినండి చూడండి తెలుసా
కావాలి అవుతుంది కాదు ఇవ్వండి తీసుకోండి రండి
ధన్యవాదాలు నమస్కారం దయచేసి క్షమించండి స్వాగతం
డబ్బు రూపాయి మొత్తం ఖాతా పొదుపు కరెంటు శాఖ రుణం వాయిదా వడ్డీ
లావాదేవీ జమ ఉపసంహరణ సౌకర్యం సమాచారం సమస్య ఫిర్యాదు
ఖాతాదారు సేవ సహాయం దరఖాస్తు ప్రక్రియ పత్రం ధృవీకరణ నమోదు
""".split()),
        "roman": frozenset("""
nenu naa naaku memu maa meeru mee meeku athanu vaaru
idi adi ee aa undi unnaru unnanu ledu avunu sare manchidi
ela emi enti ekkada eppudu enduku evaru edi
cheyandi chestanu cheppandi chebutanu vinandi chudandi telusa
kavali avutundi kadu ivvandi teesukondi randi
dhanyavadalu namaskaram dayachesi kshaminchandi swagatam
dabbu rupayi mottham khata podupu current sakha runam vayida vaddi
lavadevee jama upasamharana soukaryam samacharam samasya firyadu
khatadaru seva sahayam darakhastu prakriya patram dhruveekarana namodu
""".split()),
    },
    # =======================================================================
    "Kannada": {
        "script": "kannada",
        "native": frozenset("""
ನಾನು ನನ್ನ ನನಗೆ ನಾವು ನಮ್ಮ ನೀವು ನಿಮ್ಮ ನಿಮಗೆ ಅವರು
ಇದು ಅದು ಈ ಆ ಇದೆ ಇದ್ದಾರೆ ಇದ್ದೇನೆ ಇಲ್ಲ ಹೌದು ಸರಿ ಒಳ್ಳೆಯದು
ಹೇಗೆ ಏನು ಎಲ್ಲಿ ಯಾವಾಗ ಏಕೆ ಯಾರು ಯಾವುದು
ಮಾಡಿ ಮಾಡುತ್ತೇನೆ ಹೇಳಿ ಹೇಳುತ್ತೇನೆ ಕೇಳಿ ನೋಡಿ ಗೊತ್ತಾ
ಬೇಕು ಆಗುತ್ತದೆ ಆಗುವುದಿಲ್ಲ ಕೊಡಿ ತೆಗೆದುಕೊಳ್ಳಿ ಬನ್ನಿ
ಧನ್ಯವಾದ ನಮಸ್ಕಾರ ದಯವಿಟ್ಟು ಕ್ಷಮಿಸಿ ಸ್ವಾಗತ
ಹಣ ರೂಪಾಯಿ ಮೊತ್ತ ಖಾತೆ ಉಳಿತಾಯ ಚಾಲ್ತಿ ಶಾಖೆ ಸಾಲ ಕಂತು ಬಡ್ಡಿ
ವ್ಯವಹಾರ ಜಮಾ ಹಿಂಪಡೆಯುವಿಕೆ ಸೌಲಭ್ಯ ಮಾಹಿತಿ ಸಮಸ್ಯೆ ದೂರು
ಗ್ರಾಹಕ ಸೇವೆ ಸಹಾಯ ಅರ್ಜಿ ಪ್ರಕ್ರಿಯೆ ದಾಖಲೆ ಪರಿಶೀಲನೆ ನೋಂದಣಿ
""".split()),
        "roman": frozenset("""
naanu nanna nanage naavu namma neevu nimma nimage avaru
idu adu ee aa ide iddare iddene illa houdu sari olleyadu
hege enu elli yavaga eke yaaru yavudu
maadi maduttene heli heluttene keli nodi gotta
beku aguttade aguvudilla kodi tegedukolli banni
dhanyavada namaskara dayavittu kshamisi swagata
hana rupayi motta khate ulitaya chalti shakhe saala kantu baddi
vyavahara jama himpadeyuvike soulabhya mahiti samasye dooru
grahaka seve sahaya arji prakriye dakhale parisheelane nondani
""".split()),
    },
    # =======================================================================
    "Malayalam": {
        "script": "malayalam",
        "native": frozenset("""
ഞാൻ എന്റെ എനിക്ക് ഞങ്ങൾ ഞങ്ങളുടെ നിങ്ങൾ നിങ്ങളുടെ നിങ്ങൾക്ക് അവർ
ഇത് അത് ഈ ആ ഉണ്ട് ആണ് ഇല്ല അതെ ശരി നല്ലത്
എങ്ങനെ എന്ത് എവിടെ എപ്പോൾ എന്തുകൊണ്ട് ആര് ഏത്
ചെയ്യൂ ചെയ്യുന്നു പറയൂ പറയുന്നു കേൾക്കൂ നോക്കൂ അറിയാമോ
വേണം ആകും കഴിയും കഴിയില്ല തരൂ എടുക്കൂ വരൂ
നന്ദി നമസ്കാരം ദയവായി ക്ഷമിക്കണം സ്വാഗതം
പണം രൂപ തുക അക്കൗണ്ട് സമ്പാദ്യം കറന്റ് ശാഖ വായ്പ തവണ പലിശ
ഇടപാട് നിക്ഷേപം പിൻവലിക്കൽ സൗകര്യം വിവരം പ്രശ്നം പരാതി
ഉപഭോക്താവ് സേവനം സഹായം അപേക്ഷ നടപടിക്രമം രേഖ പരിശോധന രജിസ്ട്രേഷൻ
""".split()),
        "roman": frozenset("""
njan ente enikku njangal njangalude ningal ningalude ningalkku avar
ithu athu ee aa undu aanu illa athe sari nallath
engane enthu evide eppol enthukond aaru eth
cheyyu cheyyunnu parayu parayunnu kelkku nokku ariyamo
venam aakum kazhiyum kazhiyilla tharu edukku varu
nandi namaskaram dayavayi kshamikkanam swagatam
panam rupa thuka sampadyam sakha vaypa thavana palisha
idapad nikshepam pinvalikkal soukaryam vivaram prashnam parathi
upabhokthavu sevanam sahayam apeksha nadapadikram rekha parishodhana
""".split()),
    },
    # =======================================================================
    "Gujarati": {
        "script": "gujarati",
        "native": frozenset("""
હું મારું મને અમે અમારું તમે તમારું તમને તેઓ
આ તે છે છો છું નથી હા બરાબર સારું
કેમ શું ક્યાં ક્યારે કોણ કયું કેવી રીતે
કરો કરું છું કહો કહું સાંભળો જુઓ ખબર
જોઈએ થશે થાય નહીં આપો લો આવો
આભાર ધન્યવાદ નમસ્તે કૃપા માફ સ્વાગત
પૈસા રૂપિયા રકમ ખાતું બચત ચાલુ શાખા લોન હપ્તો વ્યાજ
વ્યવહાર જમા ઉપાડ સુવિધા માહિતી સમસ્યા ફરિયાદ
ગ્રાહક સેવા મદદ અરજી પ્રક્રિયા દસ્તાવેજ ચકાસણી નોંધણી
""".split()),
        "roman": frozenset("""
hu maru mane ame amaru tame tamaru tamne teo
aa te che chho chhu nathi ha barabar saru
kem shu kya kyare kon kayu kevi rite majama
karo karu kaho kahu sambhlo juo khabar
joie thashe thay nahi aapo lo aavo
aabhar dhanyavad namaste krupa maf swagat
paisa rupiya rakam khatu bachat chalu shakha hapto vyaj
vyavhar jama upad suvidha mahiti samasya fariyad
grahak seva madad arji prakriya dastavej chakasni nondhani
""".split()),
    },
    # =======================================================================
    "Punjabi": {
        "script": "gurmukhi",
        "native": frozenset("""
ਮੈਂ ਮੇਰਾ ਮੈਨੂੰ ਅਸੀਂ ਸਾਡਾ ਤੁਸੀਂ ਤੁਹਾਡਾ ਤੁਹਾਨੂੰ ਉਹ
ਇਹ ਹੈ ਹਨ ਹਾਂ ਨਹੀਂ ਠੀਕ ਚੰਗਾ
ਕਿਵੇਂ ਕੀ ਕਿੱਥੇ ਕਦੋਂ ਕਿਉਂ ਕੌਣ ਕਿਹੜਾ
ਕਰੋ ਕਰਦਾ ਦੱਸੋ ਦੱਸਦਾ ਸੁਣੋ ਵੇਖੋ ਪਤਾ
ਚਾਹੀਦਾ ਹੋਵੇਗਾ ਸਕਦੇ ਸਕਦਾ ਦਿਓ ਲਵੋ ਆਓ
ਧੰਨਵਾਦ ਨਮਸਕਾਰ ਕਿਰਪਾ ਮਾਫ਼ ਸਵਾਗਤ ਅਕਾਲ
ਪੈਸੇ ਰੁਪਏ ਰਕਮ ਖਾਤਾ ਬੱਚਤ ਚਾਲੂ ਸ਼ਾਖਾ ਕਰਜ਼ਾ ਕਿਸ਼ਤ ਵਿਆਜ
ਲੈਣ-ਦੇਣ ਜਮ੍ਹਾ ਕਢਵਾਉਣਾ ਸਹੂਲਤ ਜਾਣਕਾਰੀ ਸਮੱਸਿਆ ਸ਼ਿਕਾਇਤ
ਗਾਹਕ ਸੇਵਾ ਮਦਦ ਅਰਜ਼ੀ ਪ੍ਰਕਿਰਿਆ ਦਸਤਾਵੇਜ਼ ਤਸਦੀਕ ਰਜਿਸਟਰ
""".split()),
        "roman": frozenset("""
main mera mainu asi sada tusi tuhada tuhanu oh
eh hai han haan nahin theek changa
kiven ki kithe kadon kyon kaun kehda
karo karda dasso dassda suno vekho pata
chahida hovega sakde sakda dio lavo aao
dhannvaad namaskar kirpa maaf swagat akal sat sri
paise rupaye rakam khata bachat chalu shakha karza kisht viaj
len-den jamha kadhvauna sahulat jankari samassia shikayat
gahak seva madad arzi prakiriya dastavez tasdeek register
""".split()),
    },
    # =======================================================================
    "Odia": {
        "script": "odia",
        "native": frozenset("""
ମୁଁ ମୋର ମୋତେ ଆମେ ଆମର ଆପଣ ଆପଣଙ୍କ ଆପଣଙ୍କୁ ସେମାନେ
ଏହା ତାହା ଅଛି ଅଛନ୍ତି ଅଛୁ ନାହିଁ ହଁ ଠିକ ଭଲ
କେମିତି କଣ କେଉଁଠି କେବେ କାହିଁକି କିଏ କେଉଁ
କରନ୍ତୁ କରୁଛି କୁହନ୍ତୁ କହୁଛି ଶୁଣନ୍ତୁ ଦେଖନ୍ତୁ ଜାଣନ୍ତି
ଦରକାର ହେବ ପାରିବେ ପାରିବି ଦିଅନ୍ତୁ ନିଅନ୍ତୁ ଆସନ୍ତୁ
ଧନ୍ୟବାଦ ନମସ୍କାର ଦୟାକରି କ୍ଷମା ସ୍ୱାଗତ
ଟଙ୍କା ରାଶି ଖାତା ସଞ୍ଚୟ ଚଳନ୍ତି ଶାଖା ଋଣ କିସ୍ତି ସୁଧ
କାରବାର ଜମା ଉଠାଣ ସୁବିଧା ସୂଚନା ସମସ୍ୟା ଅଭିଯୋଗ
ଗ୍ରାହକ ସେବା ସାହାଯ୍ୟ ଆବେଦନ ପ୍ରକ୍ରିୟା ଦଲିଲ ଯାଞ୍ଚ ପଞ୍ଜୀକରଣ
""".split()),
        "roman": frozenset("""
mun mora mote ame amara apana apananka apanankku semane
eha taha achhi achhanti achhu nahin han thik bhala
kemiti kana keunthi kebe kahinki kie keun
karantu karuchhi kuhantu kahuchhi sunantu dekhantu jananti
darkar heba paribe paribi diantu niantu asantu
dhanyabad namaskar dayakari khyama swagata
tanka rashi khata sanchaya chalanti sakha runa kisti sudha
karabar jama uthana subidha suchana samasya abhijoga
grahaka seba sahajya abedana prakriya dalila janch panjikarana
""".split()),
    },
}
