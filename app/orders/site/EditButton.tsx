'use client'
import { useState } from 'react'
import EditOrder from './EditOrder'

export default function EditButton({ id, warehouses }: { id: string; warehouses: string[] }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="text-zinc-400 hover:text-white text-xs transition-colors"
      >
        Правити
      </button>
      {open && <EditOrder id={id} warehouses={warehouses} onClose={() => setOpen(false)} />}
    </>
  )
}
