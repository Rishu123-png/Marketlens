import { useEffect, useMemo, useRef, useState } from "react";
import Icon from "./Icon.jsx";

function cellValue(row, column) {
  return column.value ? column.value(row) : row[column.key];
}

/**
 * Dense reusable table. Sorting is local and deterministic; it never fills a
 * missing cell. Columns can declare `align` and a value accessor for nested data.
 */
export default function MarketTable({
  columns,
  rows = [],
  getRowKey = (row, index) => row.id || index,
  onRowClick,
  empty = "No rows available.",
  className = "",
  initialSort = null
}) {
  const [sort, setSort] = useState(initialSort);
  const [horizontalOverflow, setHorizontalOverflow] = useState(false);
  const scrollRef = useRef(null);

  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return undefined;
    const update = () => setHorizontalOverflow(container.scrollWidth > container.clientWidth + 1);
    update();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    observer?.observe(container);
    if (container.firstElementChild) observer?.observe(container.firstElementChild);
    window.addEventListener("resize", update);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [rows, columns]);

  const sorted = useMemo(() => {
    if (!sort) return rows;
    const column = columns.find((entry) => entry.key === sort.key);
    if (!column) return rows;
    return [...rows].sort((a, b) => {
      const av = cellValue(a, column);
      const bv = cellValue(b, column);
      if (av === null || av === undefined) return bv === null || bv === undefined ? 0 : 1;
      if (bv === null || bv === undefined) return -1;
      if (typeof av === "number" && typeof bv === "number") return sort.direction === "asc" ? av - bv : bv - av;
      return sort.direction === "asc"
        ? String(av).localeCompare(String(bv))
        : String(bv).localeCompare(String(av));
    });
  }, [rows, columns, sort]);

  function toggle(column) {
    if (column.sortable === false) return;
    setSort((current) => ({
      key: column.key,
      direction: current?.key === column.key && current.direction === "desc" ? "asc" : "desc"
    }));
  }

  return (
    <>
    {horizontalOverflow && <div className="market-table-scroll-hint">Scroll horizontally for more columns <span aria-hidden="true">→</span></div>}
    <div ref={scrollRef} className={`market-table-wrap ${className}`.trim()} tabIndex={horizontalOverflow ? 0 : undefined} role={horizontalOverflow ? "region" : undefined} aria-label={horizontalOverflow ? "Scrollable data table; use arrow keys for more columns" : undefined}>
      <table className="market-table">
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key} style={{ width: column.width, textAlign: column.align || "left" }} aria-sort={sort?.key === column.key ? (sort.direction === "asc" ? "ascending" : "descending") : undefined}>
                {column.sortable === false ? <span className="table-sort is-static">{column.label}</span> : (
                  <button type="button" className="table-sort" onClick={() => toggle(column)} aria-label={`Sort by ${column.label}`}>
                    {column.label}
                    {sort?.key === column.key && <Icon name={sort.direction === "asc" ? "up" : "down"} size={10} strokeWidth={2.4} />}
                  </button>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row, index) => (
            <tr
              key={getRowKey(row, index)}
              className={onRowClick ? "is-clickable" : ""}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              tabIndex={onRowClick ? 0 : undefined}
              onKeyDown={onRowClick ? (event) => { if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); onRowClick(row); } } : undefined}
            >
              {columns.map((column) => (
                <td key={column.key} style={{ textAlign: column.align || "left" }}>
                  {column.render ? column.render(row, index) : cellValue(row, column) ?? "—"}
                </td>
              ))}
            </tr>
          ))}
          {!sorted.length && (
            <tr>
              <td colSpan={columns.length} className="table-empty">{empty}</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
    </>
  );
}
