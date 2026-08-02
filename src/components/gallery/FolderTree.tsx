import Link from "next/link";
import { getAllFolders } from "@/lib/db/folders";
import { memo } from "react";

interface FolderTreeProps {
  selectedId?: number;
}

interface FolderNode {
  id: number;
  name: string;
  path: string;
  parent_id: number | null;
  children: FolderNode[];
}

// --- Module-level tree cache: keyed by a hash of folder ids + names ---
interface TreeCacheEntry {
  roots: FolderNode[];
  rootNode: FolderNode | null;
  displayRoots: FolderNode[];
}

let treeCache: { key: string; entry: TreeCacheEntry } | null = null;

function hashFolders(folders: import("@/lib/db/folders").FolderRow[]): string {
  // Fast hash: length + id:name tuples — sufficient for cache invalidation
  let h = String(folders.length);
  for (let i = 0; i < folders.length; i++) {
    const f = folders[i];
    h += `|${f.id}:${f.name}:${f.parent_id ?? "null"}:${f.path}`;
  }
  return h;
}

function buildTree(folders: import("@/lib/db/folders").FolderRow[]): { roots: FolderNode[]; rootNode: FolderNode | null } {
  const map = new Map<number, FolderNode>();
  const roots: FolderNode[] = [];
  let rootNode: FolderNode | null = null;

  for (const f of folders) {
    map.set(f.id, { ...f, children: [] });
  }

  for (const f of folders) {
    const node = map.get(f.id)!;
    if (f.path === "") {
      // This is the root folder
      rootNode = node;
    } else if (f.parent_id === null) {
      roots.push(node);
    } else {
      const parent = map.get(f.parent_id);
      if (parent) {
        parent.children.push(node);
      } else {
        // Orphaned to root
        roots.push(node);
      }
    }
  }

  return { roots, rootNode };
}

function sortTree(nodes: FolderNode[]): FolderNode[] {
  return nodes
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((n) => ({ ...n, children: sortTree(n.children) }));
}

function getCachedTree(folders: import("@/lib/db/folders").FolderRow[]): TreeCacheEntry {
  const key = hashFolders(folders);
  if (treeCache && treeCache.key === key) {
    return treeCache.entry;
  }
  const { roots, rootNode } = buildTree(folders);
  const sortedRoots = sortTree(roots);
  const displayRoots = rootNode ? sortTree(rootNode.children) : sortedRoots;
  const entry: TreeCacheEntry = { roots, rootNode, displayRoots };
  treeCache = { key, entry };
  return entry;
}

const FolderItem = memo(function FolderItem({ node, depth, selectedId }: { node: FolderNode; depth: number; selectedId?: number }) {
  const isSelected = node.id === selectedId;
  const href = `/?folder=${node.id}`;

  return (
    <li>
      <div className="flex items-center">
        {depth > 0 && (
          <span
            className="mr-1 text-muted-foreground/60"
            style={{ paddingLeft: `${(depth - 1) * 1}rem` }}
          >
            └
          </span>
        )}
        <Link
          href={href}
          className={[
            "flex-1 rounded-md px-2 py-1 text-sm transition-colors",
            isSelected
              ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
              : "text-sidebar-foreground/90 hover:bg-sidebar-accent/70",
          ]
            .filter(Boolean)
            .join(" ")}
        >
          {node.name || <span className="italic text-muted-foreground">Root</span>}
        </Link>
      </div>
      {node.children.length > 0 && (
        <ul className="ml-2 list-none pl-0">
          {node.children.map((child) => (
            <FolderItem
              key={child.id}
              node={child}
              depth={depth + 1}
              selectedId={selectedId}
            />
          ))}
        </ul>
      )}
    </li>
  );
});

export function FolderTree({ selectedId }: FolderTreeProps) {
  const allFolders = getAllFolders();
  if (allFolders.length === 0) return null;

  const { rootNode, displayRoots } = getCachedTree(allFolders);

  // Determine if root link should be selected
  const rootSelected = selectedId === undefined || (rootNode && selectedId === rootNode.id);

  return (
    <nav className="text-sm">
      <p className="mb-1 px-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Folders
      </p>
      <ul className="list-none pl-0">
        {/* Library root link */}
        <li>
          <Link
            href="/"
            className={[
              "flex items-center rounded-md px-2 py-1 text-sm transition-colors",
              rootSelected
                ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                : "text-sidebar-foreground/90 hover:bg-sidebar-accent/70",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            <span className="mr-1 text-muted-foreground/60">└</span>
            <span className="italic text-muted-foreground">/ (library root)</span>
          </Link>
        </li>
        {/* Root folder's children as top-level entries if root exists, otherwise roots as top-level */}
        {displayRoots.map((node) => (
          <FolderItem
            key={node.id}
            node={node}
            depth={0}
            selectedId={selectedId}
          />
        ))}
      </ul>
    </nav>
  );
}
