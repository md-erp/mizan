interface Props { cols: number; rows?: number }

export default function SkeletonRows({ cols, rows = 5 }: Props) {
  return (
    <>
      {[...Array(rows)].map((_, i) => (
        <tr key={i} className="animate-pulse">
          {[...Array(cols)].map((_, j) => (
            <td key={j} className="px-4 py-3">
              <div className={`h-3 bg-gray-200 dark:bg-gray-700 rounded ${j === 0 ? 'w-24' : j === cols - 1 ? 'w-12 ml-auto' : 'w-3/4'}`}></div>
            </td>
          ))}
        </tr>
      ))}
    </>
  )
}
