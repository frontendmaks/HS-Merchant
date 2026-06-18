'use client'
import { useRouter, useSearchParams } from 'next/navigation'

type Props = {
  column: string
  label: string
  className?: string
}

export default function SortableHeader({ column, label, className = '' }: Props) {
  const router = useRouter()
  const params = useSearchParams()
  const currentSort = params.get('sort') ?? 'name'
  const currentDir = params.get('dir') ?? 'asc'

  const isActive = currentSort === column
  const nextDir = isActive && currentDir === 'asc' ? 'desc' : 'asc'

  const handleClick = () => {
    const p = new URLSearchParams(params.toString())
    p.set('sort', column)
    p.set('dir', nextDir)
    p.delete('page')
    router.replace(`/products?${p.toString()}`)
  }

  return (
    <button
      onClick={handleClick}
      className={`flex items-center gap-1 text-xs uppercase tracking-wide transition-colors ${
        isActive ? 'text-white' : 'text-zinc-500 hover:text-zinc-300'
      } ${className}`}
    >
      {label}
      <span className="text-[10px]">
        {isActive
          ? currentDir === 'asc' ? '↑' : '↓'
          : '↕'}
      </span>
    </button>
  )
}
