'use client'

import React, { useState } from 'react'
import {
  ColumnDef,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  getPaginationRowModel,
  SortingState,
  useReactTable,
  VisibilityState,
} from '@tanstack/react-table'
import { ChevronUp, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react'

export interface DataTableProps<TData> {
  columns: ColumnDef<TData>[]
  data: TData[]
  isLoading?: boolean
  isEmpty?: boolean
  emptyStateMessage?: string
  pageSizeOptions?: number[]
  defaultPageSize?: number
  onRowClick?: (row: TData) => void
  selectable?: boolean
  onSelectionChange?: (selectedRows: TData[]) => void
  density?: 'compact' | 'normal' | 'spacious'
}

export function DataTable<TData extends { id?: string }>({
  columns,
  data,
  isLoading = false,
  isEmpty = false,
  emptyStateMessage = 'No data available',
  pageSizeOptions = [10, 20, 50],
  defaultPageSize = 10,
  onRowClick,
  density = 'normal',
}: DataTableProps<TData>) {
  const [sorting, setSorting] = useState<SortingState>([])
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({})

  const densityClasses = {
    compact: 'h-8',
    normal: 'h-10',
    spacious: 'h-12',
  }

  const table = useReactTable({
    data: isLoading ? Array(defaultPageSize).fill({}) : data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    state: {
      sorting,
      columnVisibility,
    },
    onSortingChange: setSorting,
    onColumnVisibilityChange: setColumnVisibility,
  })

  const SkeletonCell = () => (
    <div className="h-4 bg-bxo-surface-elevated rounded skeleton" />
  )

  return (
    <div className="w-full bg-bxo-surface border border-bxo-border-subtle rounded-lg overflow-hidden">
      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            {table.getHeaderGroups().map((headerGroup) => (
              <tr
                key={headerGroup.id}
                className="border-b border-bxo-border-subtle bg-bxo-surface-elevated"
              >
                {headerGroup.headers.map((header) => (
                  <th
                    key={header.id}
                    className="px-4 py-3 text-left text-xs font-semibold text-bxo-text-secondary uppercase tracking-wider"
                  >
                    {header.isPlaceholder ? null : (
                      <div
                        className={`flex items-center gap-2 ${
                          header.column.getCanSort() ? 'cursor-pointer select-none' : ''
                        }`}
                        onClick={header.column.getToggleSortingHandler()}
                        role={header.column.getCanSort() ? 'button' : undefined}
                        tabIndex={header.column.getCanSort() ? 0 : undefined}
                        onKeyDown={(e) => {
                          if (header.column.getCanSort() && e.key === 'Enter') {
                            header.column.getToggleSortingHandler()?.(e)
                          }
                        }}
                      >
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        {header.column.getCanSort() && (
                          <div className="w-4 h-4 flex items-center justify-center">
                            {header.column.getIsSorted() === 'asc' ? (
                              <ChevronUp className="w-4 h-4 text-bxo-accent-primary" />
                            ) : header.column.getIsSorted() === 'desc' ? (
                              <ChevronDown className="w-4 h-4 text-bxo-accent-primary" />
                            ) : (
                              <div className="w-4 h-4 text-bxo-text-tertiary opacity-50" />
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="h-20 text-center">
                  <div className="flex flex-col items-center justify-center gap-2">
                    <div className="text-bxo-text-secondary text-sm">{emptyStateMessage}</div>
                  </div>
                </td>
              </tr>
            ) : (
              table.getRowModel().rows.map((row) => (
                <tr
                  key={row.id}
                  className={`border-b border-bxo-border-subtle hover:bg-bxo-surface-elevated/50 transition-colors ${densityClasses[density]} ${
                    onRowClick ? 'cursor-pointer' : ''
                  }`}
                  onClick={() => onRowClick?.(row.original)}
                  onKeyDown={(event) => {
                    if (!onRowClick || isLoading) return
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      onRowClick(row.original)
                    }
                  }}
                  role={onRowClick && !isLoading ? 'button' : undefined}
                  tabIndex={onRowClick && !isLoading ? 0 : undefined}
                >
                  {row.getVisibleCells().map((cell) => (
                    <td
                      key={cell.id}
                      className="px-4 py-3 text-sm text-bxo-text-primary"
                    >
                      {isLoading ? (
                        <SkeletonCell />
                      ) : (
                        flexRender(cell.column.columnDef.cell, cell.getContext())
                      )}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Footer with Pagination */}
      {!isEmpty && (
        <div className="flex items-center justify-between px-4 py-4 border-t border-bxo-border-subtle bg-bxo-surface-elevated/50">
          <div className="flex items-center gap-2">
            <span className="text-sm text-bxo-text-secondary">
              Rows per page:
            </span>
            <select
              value={table.getState().pagination.pageSize}
              onChange={(e) => {
                table.setPageSize(Number(e.target.value))
              }}
              className="px-2 py-1 text-sm bg-bxo-surface border border-bxo-border-subtle rounded text-bxo-text-primary focus:outline-none focus:ring-2 focus:ring-bxo-accent-primary"
            >
              {pageSizeOptions.map((pageSize) => (
                <option key={pageSize} value={pageSize}>
                  {pageSize}
                </option>
              ))}
            </select>
          </div>

          <div className="text-sm text-bxo-text-secondary">
            Page {table.getState().pagination.pageIndex + 1} of {table.getPageCount()}
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage()}
              className="p-2 rounded hover:bg-bxo-surface disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              aria-label="Previous page"
            >
              <ChevronLeft className="w-4 h-4 text-bxo-text-secondary" />
            </button>

            <button
              onClick={() => table.nextPage()}
              disabled={!table.getCanNextPage()}
              className="p-2 rounded hover:bg-bxo-surface disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              aria-label="Next page"
            >
              <ChevronRight className="w-4 h-4 text-bxo-text-secondary" />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
