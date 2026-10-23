'use client'

/** Кнопка друку. На самому бланку її не видно — інакше вона б друкувалась. */
export default function PrintButton() {
  return (
    <button
      onClick={() => window.print()}
      // Сорок чотири пікселі заввишки — щоб натискати пальцем, а не нігтем
      className="print:hidden mt-8 px-5 h-11 bg-black text-white text-sm rounded"
    >
      Друк / зберегти PDF
    </button>
  )
}
