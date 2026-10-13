import sys, os, logging, asyncio
sys.path.insert(0, 'src')
from pathlib import Path

for line in Path('.env').read_text(encoding='utf-8').splitlines():
    line = line.strip()
    if not line or line.startswith('#'): continue
    if '=' in line:
        k, v = line.split('=', 1)
        os.environ[k.strip()] = v.strip()

logging.basicConfig(level=logging.DEBUG, format='%(name)s %(levelname)s %(message)s', force=True)

async def test():
    from demo_control import telegram_bot
    app = await telegram_bot.start_telegram_bot()
    print(f"start_telegram_bot returned: {app}")
    if app:
        await telegram_bot.stop_telegram_bot(app)

try:
    asyncio.run(test())
except Exception as e:
    print(f"EXCEPTION: {e}")
    import traceback
    traceback.print_exc()
