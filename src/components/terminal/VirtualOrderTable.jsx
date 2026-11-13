import MarketTable from "./MarketTable.jsx";
import { formatMoney, formatTime } from "../../lib/api.js";

const TONE = { FILLED: "ok", PENDING: "warn", REJECTED: "bad", CANCELLED: "muted" };

export default function VirtualOrderTable({ orders = [], onCancel, compact = false }) {
  const columns = [
    {
      key: "at",
      label: "TIME",
      value: (row) => row.at,
      render: (row) => <span className="muted">{formatTime(row.at)}</span>
    },
    {
      key: "side",
      label: "SIDE",
      value: (row) => row.side,
      render: (row) => <span className={`side-pill ${row.side === "BUY" ? "buy" : "sell"}`}>{row.side}</span>
    },
    { key: "symbol", label: "INSTRUMENT", value: (row) => row.symbol, render: (row) => <strong>{row.symbol}</strong> },
    { key: "qty", label: "QTY", align: "right", value: (row) => Number(row.qty), render: (row) => Number(row.qty).toLocaleString("en-IN") },
    {
      key: "fillPrice",
      label: "FILL / LIMIT",
      align: "right",
      value: (row) => Number(row.fillPrice ?? row.limitPrice ?? 0),
      render: (row) => formatMoney(row.fillPrice ?? row.limitPrice, row.currency || "INR")
    },
    {
      key: "fees",
      label: "FEES",
      align: "right",
      value: (row) => Number(row.fees || 0),
      render: (row) => formatMoney(row.fees, row.currency || "INR")
    },
    {
      key: "status",
      label: "STATUS",
      value: (row) => row.status,
      render: (row) => <span className={`order-status ${TONE[row.status] || "muted"}`}>{row.status}</span>
    }
  ];
  if (onCancel && !compact) {
    columns.push({
      key: "action",
      label: "",
      sortable: false,
      width: 66,
      render: (row) =>
        row.status === "PENDING" ? (
          <button type="button" className="table-action" onClick={(event) => { event.stopPropagation(); onCancel(row.id); }}>
            Cancel
          </button>
        ) : null
    });
  }
  return <MarketTable columns={columns} rows={orders} empty="No simulated orders. Nothing is sent to a broker." />;
}
