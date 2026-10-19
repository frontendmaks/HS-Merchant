'use client'

/** Кнопка друку. На самому бланку її не видно — інакше вона б друкувалась. */
export default function PrintButton() {
  return (
    <button
      onClick={() => window.print()}
      className="print:hidden mt-8 px-4 py-2 bg-black text-white text-sm rounded"
    >
      Друк / зберегти PDF
    </button>
  )
}
