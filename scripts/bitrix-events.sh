#!/bin/zsh
# Показує, що вписати у вихідний вебхук Бітрікса.
#
# Токен уже лежить у змінних Мерчанта — тут він лише показується вам, щоб
# перенести його в поле «Код застосунку». Нікуди не надсилається.
cd "$(dirname "$0")/.."

TOKEN=$(grep '^BITRIX_EVENT_TOKEN=' .env.local | head -1 | cut -d= -f2-)
if [ -z "$TOKEN" ]; then echo "✗ BITRIX_EVENT_TOKEN не знайдено в .env.local"; exit 1; fi

cat <<TXT

Бітрікс → Розробникам → Інше → Вихідний вебхук

  Назва             HS Merchant — зміни угод
  Обробник          https://hs-merchant.vercel.app/api/bitrix/event
  Код застосунку    $TOKEN
  Події             ONCRMDEALADD, ONCRMDEALUPDATE

Після збереження зміни в угодах приходитимуть у Мерчант тієї ж секунди.
Розклад лишається про запас — він догляне те, що не доставилось.

TXT
