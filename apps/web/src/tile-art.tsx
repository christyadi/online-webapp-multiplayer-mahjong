import { suitedTileDetails, type PhysicalTile, type TileType } from "@mahjong-together/shared";
import { createContext, useContext, type ReactNode } from "react";

type TileArtProperties = Readonly<{
  tile: PhysicalTile;
  selected?: boolean;
  onClick?: () => void;
}>;

export type TileArtworkTheme = "chinese-classical" | "classic";
export type TileFaceKind = "dots" | "bamboo" | "characters" | "honor" | "white-dragon";

export type TileFaceDefinition = Readonly<{
  kind: TileFaceKind;
  mark?: "east" | "south" | "west" | "north" | "red" | "green";
  rank?: number;
}>;

/** A future regional set only needs another complete map and its SVG symbols. */
export const TILE_ARTWORK_REGISTRY: Readonly<
  Record<TileArtworkTheme, Readonly<Record<TileType, TileFaceDefinition>>>
> = {
  "chinese-classical": createChineseClassicalFaces(),
  classic: createClassicFaces(),
};

const TileArtworkContext = createContext<TileArtworkTheme>("chinese-classical");

export function TileArtworkProvider({
  artwork,
  children,
}: Readonly<{ artwork: TileArtworkTheme; children: ReactNode }>) {
  return <TileArtworkContext.Provider value={artwork}>{children}</TileArtworkContext.Provider>;
}

export function tileFaceDefinition(
  type: TileType,
  theme: TileArtworkTheme = "chinese-classical",
): TileFaceDefinition {
  return TILE_ARTWORK_REGISTRY[theme][type];
}

export function TileArt({ tile, selected = false, onClick }: TileArtProperties) {
  const artwork = useContext(TileArtworkContext);
  const label = tileLabel(tile.type);
  const face = (
    <svg
      aria-label={label}
      className={`tile-art${selected ? " is-selected" : ""}`}
      role="img"
      viewBox="0 0 64 88"
    >
      <title>{label}</title>
      <TileSymbols />
      <rect className="tile-shadow" height="82" rx="7" width="58" x="4" y="5" />
      <rect className="tile-edge" height="80" rx="6" width="56" x="3" y="2" />
      <rect className="tile-face" height="76" rx="4" width="52" x="5" y="4" />
      <path className="tile-shine" d="M10 8h40" />
      <TileFace definition={tileFaceDefinition(tile.type, artwork)} artwork={artwork} />
    </svg>
  );

  return onClick === undefined ? (
    face
  ) : (
    <button
      aria-label={`${selected ? "Deselect" : "Select"} ${label}`}
      aria-pressed={selected}
      className="tile-button"
      onClick={onClick}
      type="button"
    >
      {face}
    </button>
  );
}

function TileFace({
  artwork,
  definition,
}: Readonly<{ artwork: TileArtworkTheme; definition: TileFaceDefinition }>) {
  if (artwork === "classic") return <ClassicTileFace definition={definition} />;
  if (definition.kind === "dots") return <DotFace rank={definition.rank ?? 1} />;
  if (definition.kind === "bamboo") return <BambooFace rank={definition.rank ?? 1} />;
  if (definition.kind === "characters") return <CharacterFace rank={definition.rank ?? 1} />;
  if (definition.kind === "white-dragon")
    return <path className="tile-white-dragon" d="M15 24h34v40H15z" />;
  return (
    <use
      className={`tile-honor-mark tile-honor-${definition.mark ?? "east"}`}
      height="38"
      href={`#chinese-${definition.mark ?? "east"}`}
      width="38"
      x="13"
      y="25"
    />
  );
}

const CLASSIC_HONOR_LABELS: Readonly<Record<string, string>> = {
  east: "E",
  green: "G",
  north: "N",
  red: "R",
  south: "S",
  west: "W",
  white: "W",
};

function ClassicTileFace({ definition }: Readonly<{ definition: TileFaceDefinition }>) {
  const rankMark =
    definition.rank === undefined ? null : (
      <text className="tile-classic-rank" x="8" y="14">
        {definition.rank}
      </text>
    );
  if (definition.kind === "dots") {
    return (
      <>
        {rankMark}
        <g className="tile-classic-dots">
          {Array.from({ length: definition.rank ?? 1 }, (_, index) => (
            <circle
              cx={18 + (index % 3) * 14}
              cy={22 + Math.floor(index / 3) * 14}
              key={index}
              r="4"
            />
          ))}
        </g>
      </>
    );
  }
  if (definition.kind === "bamboo") {
    return (
      <>
        {rankMark}
        <g className="tile-classic-bamboo">
          {Array.from({ length: definition.rank ?? 1 }, (_, index) => (
            <path
              d={`M${String(16 + (index % 3) * 14)} ${String(17 + Math.floor(index / 3) * 13)}v10`}
              key={index}
            />
          ))}
        </g>
      </>
    );
  }
  if (definition.kind === "characters") {
    return (
      <>
        {rankMark}
        <g className="tile-classic-characters">
          <text x="32" y="34" textAnchor="middle">
            {definition.rank}
          </text>
          <path d="M18 43h28M22 48h20" />
        </g>
      </>
    );
  }
  return (
    <text
      className={`tile-classic-honor tile-classic-${definition.mark ?? "white"}`}
      x="32"
      y="48"
      textAnchor="middle"
    >
      {CLASSIC_HONOR_LABELS[definition.mark ?? "white"] ?? "W"}
    </text>
  );
}

const DOT_LAYOUTS: Readonly<Record<number, readonly [number, number][]>> = {
  1: [[32, 43]],
  2: [
    [22, 27],
    [42, 59],
  ],
  3: [
    [22, 25],
    [32, 43],
    [42, 61],
  ],
  4: [
    [21, 27],
    [43, 27],
    [21, 59],
    [43, 59],
  ],
  5: [
    [21, 27],
    [43, 27],
    [32, 43],
    [21, 59],
    [43, 59],
  ],
  6: [
    [20, 25],
    [44, 25],
    [20, 43],
    [44, 43],
    [20, 61],
    [44, 61],
  ],
  7: [
    [20, 24],
    [44, 24],
    [32, 35],
    [20, 43],
    [44, 43],
    [20, 61],
    [44, 61],
  ],
  8: [
    [20, 24],
    [44, 24],
    [20, 37],
    [44, 37],
    [20, 50],
    [44, 50],
    [20, 63],
    [44, 63],
  ],
  9: [
    [20, 24],
    [32, 24],
    [44, 24],
    [20, 43],
    [32, 43],
    [44, 43],
    [20, 62],
    [32, 62],
    [44, 62],
  ],
};

function DotFace({ rank }: Readonly<{ rank: number }>) {
  return (
    <g className="tile-dots">
      {(DOT_LAYOUTS[rank] ?? [[32, 43]]).map(([cx, cy], index) => (
        <use
          className={`tile-dot tile-dot-${dotInk(rank, index)}`}
          height="12"
          href="#dot-pip"
          key={`${String(cx)}-${String(cy)}`}
          width="12"
          x={cx - 6}
          y={cy - 6}
        />
      ))}
    </g>
  );
}

function BambooFace({ rank }: Readonly<{ rank: number }>) {
  if (rank === 1)
    return (
      <use className="tile-bamboo-bird" height="45" href="#bamboo-bird" width="38" x="13" y="22" />
    );
  return (
    <g className="tile-bamboo">
      {(
        DOT_LAYOUTS[rank] ?? [
          [22, 27],
          [42, 59],
        ]
      ).map(([cx, cy]) => (
        <use
          height="15"
          href="#bamboo-stalk"
          key={`${String(cx)}-${String(cy)}`}
          width="10"
          x={cx - 5}
          y={cy - 7.5}
        />
      ))}
    </g>
  );
}

function CharacterFace({ rank }: Readonly<{ rank: number }>) {
  return (
    <g className="tile-characters">
      <text x="32" y="53" textAnchor="middle">
        {rank}
      </text>
    </g>
  );
}

function dotInk(rank: number, index: number): "red" | "blue" | "green" {
  if (rank === 1) return "red";
  if (rank === 2 || rank === 3) return index === 0 ? "green" : "blue";
  if (rank === 5) return index === 2 ? "red" : "blue";
  if (rank === 7) return index === 2 ? "green" : "red";
  if (rank === 9) return index === 4 ? "red" : index % 2 === 0 ? "blue" : "green";
  return index % 2 === 0 ? "blue" : "red";
}

function TileSymbols() {
  return (
    <defs>
      <symbol id="dot-pip" viewBox="0 0 12 12">
        <circle cx="6" cy="6" r="4.6" />
        <circle className="tile-pip-highlight" cx="4.5" cy="4.2" r="1" />
      </symbol>
      <symbol id="bamboo-stalk" viewBox="0 0 10 15">
        <path d="M5 1.5v12M2 4.5h6M2 10.5h6" />
      </symbol>
      <symbol id="bamboo-bird" viewBox="0 0 38 45">
        <path
          d="M19 7c-6 3-9 10-7 17 2 8 6 12 7 13 1-1 5-5 7-13 2-7-1-14-7-17Z"
          fill="#d4a42e"
          stroke="#9b6b18"
        />
        <path
          d="M18 19c-6 1-9 5-10 10 5-2 8-3 11-1M20 19c6 1 9 5 10 10-5-2-8-3-11-1"
          stroke="#b3322d"
        />
        <path d="M17 35 11 42M20 35l7 7M19 8V3M19 3l4 3M19 3l-4 3" stroke="#276f47" />
      </symbol>
      <symbol id="chinese-east" viewBox="0 0 38 38">
        <path d="M6 10h26M9 18h20M6 27h26M19 5v29M11 10l5 8-5 9M27 10l-5 8 5 9" />
      </symbol>
      <symbol id="chinese-south" viewBox="0 0 38 38">
        <path d="M7 7h24M10 15h18M19 5v27M9 32l10-8 10 8" />
      </symbol>
      <symbol id="chinese-west" viewBox="0 0 38 38">
        <path d="M7 7h24M10 14h18M8 22h22M12 22v11M26 22v11M12 33h14" />
      </symbol>
      <symbol id="chinese-north" viewBox="0 0 38 38">
        <path d="M6 8h26M11 8v24M27 8v24M11 15h16M11 23h16M16 15v17M22 15v17" />
      </symbol>
      <symbol id="chinese-red" viewBox="0 0 38 38">
        <path d="M6 10h26M19 5v29M10 18h18M10 28h18" />
      </symbol>
      <symbol id="chinese-green" viewBox="0 0 38 38">
        <path d="M7 7h24M7 16h24M7 28h24M12 7v26M26 7v26M12 22h14M19 16v17" />
      </symbol>
    </defs>
  );
}

function createChineseClassicalFaces(): Readonly<Record<TileType, TileFaceDefinition>> {
  const faces = {} as Record<TileType, TileFaceDefinition>;
  for (const suit of ["d", "b", "c"] as const)
    for (let rank = 1; rank <= 9; rank += 1) {
      faces[`${suit}${String(rank)}` as TileType] = {
        kind: suit === "d" ? "dots" : suit === "b" ? "bamboo" : "characters",
        rank,
      };
    }
  faces.east = { kind: "honor", mark: "east" };
  faces.south = { kind: "honor", mark: "south" };
  faces.west = { kind: "honor", mark: "west" };
  faces.north = { kind: "honor", mark: "north" };
  faces.red = { kind: "honor", mark: "red" };
  faces.green = { kind: "honor", mark: "green" };
  faces.white = { kind: "white-dragon" };
  return faces;
}

function createClassicFaces(): Readonly<Record<TileType, TileFaceDefinition>> {
  return createChineseClassicalFaces();
}

export function tileLabel(type: TileType): string {
  const details = suitedTileDetails(type);
  if (details !== null)
    return `${String(details.rank)} of ${details.suit} · value ${String(details.rank)}`;
  const honorName =
    type === "east" || type === "south" || type === "west" || type === "north"
      ? `${type} wind`
      : `${type} dragon`;
  return `${honorName} · value 0`;
}
