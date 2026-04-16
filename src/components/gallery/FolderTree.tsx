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

const FolderItem = memo(function FolderItem({ node, depth, selectedId }: { node: FolderNode; depth: number; selectedId?: number }) {
  const isSelected = node.id === selectedId;
  const href = `/?folder=${node.id}`;

  return (
    <li>
      <div className="flex items-center">
        {depth > 0 && (
          <span
            className="mr-1 text-zinc-400"
            style={{ paddingLeft: `${(depth - 1) * 1}rem` }}
          >
            └
          </span>
        )}
        <Link
          href={href}
          className={[
            "flex-1 rounded px-2 py-1 text-sm transition",
            isSelected
              ? "bg-blue-100 font-medium text-blue-700 dark:bg-blue-900 dark:text-blue-300"
              : "text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800",
          ]
            .filter(Boolean)
            .join(" ")}
        >
          {node.name || <span className="italic text-zinc-400">Root</span>}
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

  const { roots, rootNode } = buildTree(allFolders);
  const sortedRoots = sortTree(roots);
  const displayRoots = rootNode ? sortTree(rootNode.children) : sortedRoots;

  // Determine if root link should be selected
  const rootSelected = selectedId === undefined || (rootNode && selectedId === rootNode.id);

  return (
    <nav className="text-sm">
      <p className="mb-1 px-2 text-xs font-semibold uppercase tracking-wider text-zinc-400">
        Folders
      </p>
      <ul className="list-none pl-0">
        {/* Library root link */}
        <li>
          <Link
            href="/"
            className={[
              "flex items-center rounded px-2 py-1 text-sm transition",
              rootSelected
                ? "bg-blue-100 font-medium text-blue-700 dark:bg-blue-900 dark:text-blue-300"
                : "text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            <span className="mr-1 text-zinc-400">└</span>
            <span className="italic text-zinc-500">/ (library root)</span>
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
