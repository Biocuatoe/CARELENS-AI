import os, sys
sys.path.insert(0, 'src')
from pathlib import Path
for line in (Path('.env')).read_text(encoding='utf-8').splitlines():
    line = line.strip()
    if not line or line.startswith('#'): continue
    if '=' in line:
        k, v = line.split('=', 1)
        os.environ[k.strip()] = v.strip()

token = os.environ.get('TELEGRAM_BOT_TOKEN', '')
chat_ids = os.environ.get('ALLOWED_CHAT_IDS', '')
admin = os.environ.get('TELEGRAM_ADMIN_CHAT_ID', '')
print(f'TOKEN present: {bool(token)}, prefix={token[:8]}****{token[-4:] if token else ""}')
print(f'ALLOWED_CHAT_IDS: {chat_ids}')
print(f'TELEGRAM_ADMIN_CHAT_ID: {admin}')
configured = bool(token and chat_ids)
print(f'BOT_IS_CONFIGURED: {configured}')
