"use client";

import { useActionState, useState } from "react";

import { deleteItem, markCashSold, relistItem } from "@/app/seller/actions";
import { Button, Sheet, SubmitButton } from "@/components/ui";
import type { ItemStatus } from "@/lib/supabase/types";

import type { ItemStatusState } from "./action-state";
import { canDeleteItem, canMarkCashSold, canRelist } from "./item-status";
import { Notice } from "./notice";

/** Sold for cash, put back on sale, and delete, each shown only when the item allows it. */
export function ItemStatusActions({ itemId, title, status }: { itemId: string; title: string; status: ItemStatus }) {
  const [cashState, cashAction] = useActionState<ItemStatusState, FormData>(markCashSold, {});
  const [relistState, relistAction] = useActionState<ItemStatusState, FormData>(relistItem, {});
  const [deleteState, deleteAction] = useActionState<ItemStatusState, FormData>(deleteItem, {});
  const [confirmDelete, setConfirmDelete] = useState(false);

  const error = cashState.error ?? relistState.error;
  if (!canMarkCashSold(status) && !canRelist(status) && !canDeleteItem(status)) return null;

  return (
    <div className="flex flex-col gap-3">
      {error ? <Notice tone="danger">{error}</Notice> : null}

      {canMarkCashSold(status) ? (
        <form action={cashAction} className="flex flex-col gap-1.5">
          <input type="hidden" name="itemId" value={itemId} />
          <SubmitButton variant="secondary" fullWidth pendingLabel="Recording the sale">
            Sold for cash
          </SubmitButton>
          <p className="text-center text-sm text-ink-soft">Someone paid you in person. It comes off the map.</p>
        </form>
      ) : null}

      {canRelist(status) ? (
        <form action={relistAction}>
          <input type="hidden" name="itemId" value={itemId} />
          <SubmitButton variant="secondary" fullWidth pendingLabel="Putting it back">
            Put back on sale
          </SubmitButton>
        </form>
      ) : null}

      {canDeleteItem(status) ? (
        <>
          <Button variant="ghost" fullWidth onClick={() => setConfirmDelete(true)}>
            Delete item
          </Button>
          <Sheet
            open={confirmDelete}
            onClose={() => setConfirmDelete(false)}
            title="Delete this item?"
            description={`${title} comes off your table and the map. This cannot be undone.`}
            closeLabel="Keep item"
          >
            <form action={deleteAction} className="flex flex-col gap-3">
              <input type="hidden" name="itemId" value={itemId} />
              {deleteState.error ? <Notice tone="danger">{deleteState.error}</Notice> : null}
              <SubmitButton variant="danger" fullWidth pendingLabel="Deleting">
                Delete item
              </SubmitButton>
              <Button variant="ghost" fullWidth onClick={() => setConfirmDelete(false)}>
                Keep it
              </Button>
            </form>
          </Sheet>
        </>
      ) : null}
    </div>
  );
}
