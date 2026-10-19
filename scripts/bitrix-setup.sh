#!/bin/zsh
# Кладе посилання вебхука Бітрікса у змінні Vercel.
#
# Посилання — це ключ доступу до CRM, тож воно ніде не показується й нікуди
# не записується, крім зашифрованої змінної. Назовні виходить лише «доступ є».
cd "$(dirname "$0")/.."

echo "Вставте посилання вхідного вебхука (Бітрікс → Розробникам → Інтеграції → ID 28)."
echo "Виглядає як https://crm.halytska-svizhyna.ua/rest/810/<код>/"
read "HOOK?Посилання: "
HOOK="${HOOK%/}"

echo ""
if curl -sf "$HOOK/profile" -o /tmp/bitrix-profile.json; then
  python3 -c "import json;d=json.load(open('/tmp/bitrix-profile.json'))['result'];print('✓ Доступ є:', d.get('NAME'), d.get('LAST_NAME'))"
else
  echo "✗ Вебхук не відповідає — перевірте посилання"; exit 1
fi

for ENV in production development; do
  vercel env rm BITRIX_WEBHOOK_URL $ENV --yes > /dev/null 2>&1
  if printf '%s' "$HOOK" | vercel env add BITRIX_WEBHOOK_URL $ENV > /dev/null 2>&1; then
    echo "✓ записано у $ENV"
  else
    echo "! $ENV — не записалось, спробуйте ще раз"
  fi
done

grep -q '^BITRIX_WEBHOOK_URL=' .env.local 2>/dev/null \
  && sed -i '' "s|^BITRIX_WEBHOOK_URL=.*|BITRIX_WEBHOOK_URL=$HOOK|" .env.local \
  || printf '\nBITRIX_WEBHOOK_URL=%s\n' "$HOOK" >> .env.local
echo "✓ записано і локально (.env.local, у git не йде)"
unset HOOK
