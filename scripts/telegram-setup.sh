#!/bin/zsh
# Кладе токен телеграм-бота у змінні Vercel.
#
# Токен — це ключ до бота, тож він ніде не показується й нікуди не
# записується, крім зашифрованої змінної. Назовні виходить лише ім'я бота
# й перелік груп, які він бачить.
cd "$(dirname "$0")/.."

echo "Вставте токен бота (BotFather → /newbot або /token для наявного)."
read "TOKEN?Токен: "
TOKEN="${TOKEN// /}"

echo ""
if curl -sf "https://api.telegram.org/bot$TOKEN/getMe" -o /tmp/tg-me.json; then
  python3 -c "import json;d=json.load(open('/tmp/tg-me.json'))['result'];print('✓ Бот:', d.get('first_name'), '@'+d.get('username',''))"
else
  echo "✗ Телеграм не прийняв токен"; exit 1
fi

echo "\nГрупи, які бот уже бачить:"
curl -sf "https://api.telegram.org/bot$TOKEN/getUpdates?limit=100" -o /tmp/tg-updates.json && python3 -c "
import json
d=json.load(open('/tmp/tg-updates.json')).get('result',[])
seen={}
for u in d:
    c=(u.get('message') or u.get('my_chat_member') or {}).get('chat')
    if c and c.get('type')!='private': seen[c['id']]=c.get('title')
print('\n'.join(f'  {t}' for t in seen.values()) or '  поки жодної — додайте бота в групи складів')
"

for ENV in production development; do
  vercel env rm TELEGRAM_BOT_TOKEN $ENV --yes > /dev/null 2>&1
  if printf '%s' "$TOKEN" | vercel env add TELEGRAM_BOT_TOKEN $ENV > /dev/null 2>&1; then
    echo "✓ записано у $ENV"
  else
    echo "! $ENV — не записалось"
  fi
done

grep -q '^TELEGRAM_BOT_TOKEN=' .env.local 2>/dev/null \
  && sed -i '' "s|^TELEGRAM_BOT_TOKEN=.*|TELEGRAM_BOT_TOKEN=$TOKEN|" .env.local \
  || printf '\nTELEGRAM_BOT_TOKEN=%s\n' "$TOKEN" >> .env.local
echo "✓ записано і локально"
rm -f /tmp/tg-me.json /tmp/tg-updates.json
unset TOKEN
