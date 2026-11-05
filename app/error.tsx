'use client'
export default function ErrorPage({ reset }: { reset: () => void }) {
  return <div className="p-8 space-y-4 text-white">
    <h1 className="text-xl font-semibold">Не вдалося завантажити дані</h1>
    <p className="text-zinc-400">Сервіс тимчасово не відповідає. Спробуйте ще раз.</p>
    <button onClick={reset} className="rounded-lg bg-red-600 px-4 py-2">Повторити</button>
  </div>
}
