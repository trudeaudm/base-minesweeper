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

/** Cracked/exploded Base "b" for mine tiles */
export function BaseMineIcon({
  size = 32,
  className = "",
}: {
  size?: number;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center justify-center font-bold leading-none ${className}`}
      style={{ fontSize: size * 0.7, width: size, height: size }}
    >
      💥
    </span>
  );
}
