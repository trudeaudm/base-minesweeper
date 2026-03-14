/** Base Chain "b" logo as an inline SVG component. */
export function BaseLogo({
  size = 24,
  className = "",
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 111 111"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <path
        d="M54.921 110.034C85.359 110.034 110.034 85.402 110.034 55.017C110.034 24.6317 85.359 0 54.921 0C26.0432 0 2.35281 22.1714 0 50.3923H72.8467V59.6416H3.35598e-07C2.35281 87.8625 26.0432 110.034 54.921 110.034Z"
        fill="white"
      />
    </svg>
  );
}

/** Base circle logo: blue circle with white horizontal bar (for mine icon & VRF animation). */
export function BaseCircleLogo({
  size = 24,
  className = "",
  spinBar = false,
}: {
  size?: number;
  className?: string;
  spinBar?: boolean;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <circle cx="16" cy="16" r="14" fill="#0052FF" />
      <rect
        x="6"
        y="13"
        width="20"
        height="6"
        rx="1"
        fill="white"
        className={spinBar ? "origin-center animate-vrf-bar-spin" : ""}
        style={spinBar ? { transformOrigin: "50% 50%", transformBox: "fill-box" } : undefined}
      />
    </svg>
  );
}

/** Mine tile icon: Base circle logo (shown on red background). */
export function BaseMineIcon({
  size = 32,
  className = "",
}: {
  size?: number;
  className?: string;
}) {
  return (
    <span className={`inline-flex items-center justify-center ${className}`}>
      <BaseCircleLogo size={size} />
    </span>
  );
}
