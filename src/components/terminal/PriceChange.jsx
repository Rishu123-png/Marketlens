import Icon from "./Icon.jsx";
import { changeTone, signedPercent, numberOrNull } from "../../lib/marketVisuals.js";

export default function PriceChange({ value, percent = false, showIcon = true, size = "md", className = "", prefix = "" }) {
  const number = numberOrNull(value);
  const tone = changeTone(number);
  const text = percent ? signedPercent(number) : number === null ? "—" : `${number > 0 ? "+" : ""}${number.toFixed(2)}`;
  return (
    <span className={`price-change ${tone} size-${size} ${className}`.trim()}>
      {prefix && <span className="price-change-prefix">{prefix}</span>}
      {showIcon && number !== null && number !== 0 && (
        <Icon name={number > 0 ? "up" : "down"} size={size === "sm" ? 10 : 12} strokeWidth={2.4} />
      )}
      {text}
    </span>
  );
}
