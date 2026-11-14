"use client";

import { useId, useLayoutEffect, useRef, useState, type ElementType, type ReactNode } from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, arrayMove, rectSortingStrategy, sortableKeyboardCoordinates, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { listValueSchema } from "@/lib/content/schemas";
import { useEditorApi } from "./context";
import type { EditableListClientProps } from "./types";

const SCHEMA_MAX = 200; // listValueSchema
const ID_ALPHABET = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

/** Short random id matching listItemIdSchema ([a-zA-Z0-9_-]{1,32}). */
export function newItemId(existing: readonly string[]): string {
  for (;;) {
    const bytes = crypto.getRandomValues(new Uint8Array(8));
    const id = Array.from(bytes, (b) => ID_ALPHABET[b % ID_ALPHABET.length]).join("");
    if (!existing.includes(id)) return id;
  }
}

const sameIds = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((v, i) => v === b[i]);

export function EditableListClient({
  scope,
  blockKey,
  itemIds,
  items,
  as,
  itemAs,
  className,
  itemClassName,
  addLabel,
  max,
}: EditableListClientProps) {
  const api = useEditorApi();
  const dndId = useId();
  const [order, setOrder] = useState(itemIds);
  const [busy, setBusy] = useState(false);

  // Server re-rendered with a new list (after refresh): adopt it.
  const [seenIds, setSeenIds] = useState(itemIds);
  if (!sameIds(seenIds, itemIds)) {
    setSeenIds(itemIds);
    setOrder(itemIds);
  }

  const nodes = new Map<string, ReactNode>(itemIds.map((id, i) => [id, items[i]]));
  const limit = Math.min(max ?? SCHEMA_MAX, SCHEMA_MAX);
  const canAdd = !busy && order.length < limit;
  const label = addLabel ?? "Add item";

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  /** Flush pending edits + save the new structure in one request, then re-render from the server. */
  const commit = async (next: string[]) => {
    const value = listValueSchema.safeParse({ items: next });
    if (!value.success) return;
    const prev = order;
    setOrder(next);
    setBusy(true);
    const ok = await api.flush([{ scope, key: blockKey, type: "list", value: value.data }]);
    setBusy(false);
    if (!ok) {
      setOrder(prev);
      return;
    }
    api.refresh();
  };

  const move = (from: number, to: number) => {
    if (busy || to < 0 || to >= order.length || from === to) return;
    void commit(arrayMove(order, from, to));
  };

  const addAfter = (index: number) => {
    if (!canAdd) return;
    const next = [...order];
    next.splice(index + 1, 0, newItemId(order));
    void commit(next);
  };

  const remove = (index: number) => {
    if (busy) return;
    if (!window.confirm("Delete this item? You can undo by discarding drafts before publishing.")) return;
    void commit(order.filter((_, i) => i !== index));
  };

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    move(order.indexOf(String(active.id)), order.indexOf(String(over.id)));
  };

  // Tag names come from a fixed union in the props contract.
  const Tag = as as ElementType;
  const ItemTag = itemAs as ElementType;

  return (
    <DndContext id={dndId} sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={order} strategy={rectSortingStrategy} disabled={busy}>
        <Tag className={className} data-toofi-list={blockKey} aria-busy={busy || undefined}>
          {order.map((id, index) => (
            <SortableItem
              key={id}
              id={id}
              as={ItemTag}
              className={itemClassName}
              index={index}
              count={order.length}
              busy={busy}
              canAdd={canAdd}
              addLabel={label}
              onMove={move}
              onAdd={addAfter}
              onRemove={remove}
            >
              {nodes.get(id)}
            </SortableItem>
          ))}
          {order.length === 0 && (
            <ItemTag className={itemClassName}>
              <button type="button" className="toofi-btn toofi-list-empty" disabled={!canAdd} onClick={() => addAfter(-1)}>
                + {label}
              </button>
            </ItemTag>
          )}
        </Tag>
      </SortableContext>
    </DndContext>
  );
}

function SortableItem({
  id,
  as: ItemTag,
  className,
  index,
  count,
  busy,
  canAdd,
  addLabel,
  onMove,
  onAdd,
  onRemove,
  children,
}: {
  id: string;
  as: ElementType;
  className?: string;
  index: number;
  count: number;
  busy: boolean;
  canAdd: boolean;
  addLabel: string;
  onMove: (from: number, to: number) => void;
  onAdd: (index: number) => void;
  onRemove: (index: number) => void;
  children: ReactNode;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id });
  const elRef = useRef<HTMLElement | null>(null);

  // Controls are absolutely positioned inside the item; make it a containing block
  // only if it isn't one already (static → relative doesn't move anything).
  useLayoutEffect(() => {
    const el = elRef.current;
    if (el && getComputedStyle(el).position === "static") el.style.position = "relative";
  }, []);

  const n = index + 1;
  return (
    <ItemTag
      ref={(el: HTMLElement | null) => {
        elRef.current = el;
        setNodeRef(el);
      }}
      className={className}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      data-toofi-list-item=""
      data-dragging={isDragging || undefined}
    >
      <div className="toofi-item-controls" contentEditable={false} role="group" aria-label={`Item ${n} of ${count}`}>
        <button
          type="button"
          ref={setActivatorNodeRef}
          className="toofi-icon-btn toofi-drag"
          disabled={busy}
          {...attributes}
          {...listeners}
          aria-label={`Drag to reorder item ${n}`}
          title="Drag to reorder"
        >
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
            <path d="M6 3h1v1H6zM9 3h1v1H9zM6 7.5h1v1H6zM9 7.5h1v1H9zM6 12h1v1H6zM9 12h1v1H9z" fill="currentColor" stroke="currentColor" />
          </svg>
        </button>
        <button
          type="button"
          className="toofi-icon-btn"
          disabled={busy || index === 0}
          onClick={() => onMove(index, index - 1)}
          aria-label={`Move item ${n} up`}
          title="Move up"
        >
          ↑
        </button>
        <button
          type="button"
          className="toofi-icon-btn"
          disabled={busy || index === count - 1}
          onClick={() => onMove(index, index + 1)}
          aria-label={`Move item ${n} down`}
          title="Move down"
        >
          ↓
        </button>
        <button
          type="button"
          className="toofi-icon-btn"
          disabled={!canAdd}
          onClick={() => onAdd(index)}
          aria-label={`${addLabel} after item ${n}`}
          title={addLabel}
        >
          +
        </button>
        <button
          type="button"
          className="toofi-icon-btn toofi-danger"
          disabled={busy}
          onClick={() => onRemove(index)}
          aria-label={`Delete item ${n}`}
          title="Delete"
        >
          ×
        </button>
      </div>
      {children ?? (
        <div className="toofi-item-loading" role="status">
          <span className="toofi-spinner" aria-hidden="true" /> Adding…
        </div>
      )}
    </ItemTag>
  );
}
