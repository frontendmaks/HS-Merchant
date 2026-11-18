-- Розмови з Rozetka і Prom синхронізуються опитуванням: те саме повідомлення
-- приходить щоразу, тож записати його двічі не можна
create unique index if not exists chat_messages_thread_external_key
  on public.chat_messages (thread_id, external_id) where external_id is not null;

-- Те, що потрібне каналу для відповіді: одержувач у Rozetka, тема розмови
alter table public.chat_threads add column if not exists meta jsonb not null default '{}'::jsonb;
alter table public.chat_threads add column if not exists subject text;
