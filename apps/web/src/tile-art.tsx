import { suitedTileDetails, type PhysicalTile, type TileType } from "@mahjong-together/shared";

type TileArtProperties = Readonly<{
  tile: PhysicalTile;
  selected?: boolean;
  onClick?: () => void;
}>;

const HONOR_LABELS: Record<string, string> = {
  east: "E",
  green: "G",
  north: "N",
  red: "R",
  south: "S",
  west: "W",
  white: "W",
};

export function TileArt({ tile, selected = false, onClick }: TileArtProperties) {
  const details = suitedTileDetails(tile.type);
  const label = tileLabel(tile.type);
  const content =
    details === null ? (
      <text className={`tile-honor tile-${tile.type}`} x="32" y="48" textAnchor="middle">
        {HONOR_LABELS[tile.type] ?? "?"}
      </text>
    ) : details.suit === "dots" ? (
      <g className="tile-dots">
        {Array.from({ length: details.rank }, (_, index) => (
          <circle
            cx={18 + (index % 3) * 14}
            cy={22 + Math.floor(index / 3) * 14}
            key={index}
            r="4"
          />
        ))}
      </g>
    ) : details.suit === "bamboo" ? (
      <g className="tile-bamboo">
        {Array.from({ length: details.rank }, (_, index) => (
          <path
            d={`M${String(16 + (index % 3) * 14)} ${String(17 + Math.floor(index / 3) * 13)}v10`}
            key={index}
          />
        ))}
      </g>
    ) : (
      <g className="tile-characters">
        <text x="32" y="34" textAnchor="middle">
          {details.rank}
        </text>
        <path d="M18 43h28M22 48h20" />
      </g>
    );

  const face = (
    <svg
      aria-label={label}
      className={`tile-art${selected ? " is-selected" : ""}`}
      role="img"
      viewBox="0 0 64 88"
    >
      <rect className="tile-shadow" height="84" rx="6" width="58" x="4" y="4" />
      <rect className="tile-face" height="80" rx="5" width="54" x="3" y="2" />
      <text className="tile-rank" x="8" y="14">
        {details?.rank ?? ""}
      </text>
      {content}
    </svg>
  );

  return onClick === undefined ? (
    face
  ) : (
    <button aria-label={`Select ${label}`} className="tile-button" onClick={onClick} type="button">
      {face}
    </button>
  );
}

function tileLabel(type: TileType): string {
  const details = suitedTileDetails(type);
  if (details !== null) return `${String(details.rank)} ${details.suit}`;
  return type === "white" ? "white dragon" : `${type} wind/dragon`;
}
