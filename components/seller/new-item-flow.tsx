"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";

import { createItem } from "@/app/seller/actions";
import { Button, Card, CardTitle, Field, formatMoney, Input, Spinner, Textarea } from "@/components/ui";
import { LISTING_CATEGORIES, LISTING_CONDITIONS, ListingDraft } from "@/lib/ai/schemas";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import type { ItemCategory, ItemCondition } from "@/lib/supabase/types";

import { downscaleImage, PhotoPrepError, type PreparedPhoto } from "./downscale-image";
import {
  CATEGORY_LABELS,
  CONDITION_LABELS,
  MAX_DESCRIPTION_LENGTH,
  MAX_TITLE_LENGTH,
  photoPathFor,
  priceToInput,
  type FieldErrors,
} from "./forms";
import { ItemPhoto } from "./item-photo";
import { Notice } from "./notice";
import { householdQuery, pricingAllowsManualEntry, pricingErrorMessage } from "./seller-copy";
import { SelectField } from "./select-field";

const PHOTO_BUCKET = "item-photos";

type Form = {
  title: string;
  description: string;
  category: ItemCategory;
  condition: ItemCondition;
  price: string;
};

type Suggestion = {
  priceLow: number;
  priceHigh: number;
  priceReason: string;
  confidenceNote: string;
};

const EMPTY_FORM: Form = { title: "", description: "", category: "other", condition: "good", price: "" };

function errorCode(body: unknown): string | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const code = (body as { error?: unknown }).error;
  return typeof code === "string" ? code : undefined;
}

/**
 * Photo first: take or pick a photo, shrink it on the phone, get a suggested listing,
 * edit it, then upload the photo and list the item. Nothing typed is lost on an error.
 */
export function NewItemFlow({ householdId }: { householdId: string }) {
  const router = useRouter();
  const cameraRef = useRef<HTMLInputElement>(null);
  const libraryRef = useRef<HTMLInputElement>(null);
  /** The photo already in storage, so a retry after a failed insert does not upload twice. */
  const uploadedRef = useRef<{ blob: Blob; path: string } | null>(null);

  const [photo, setPhoto] = useState<PreparedPhoto | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);

  const [pricing, setPricing] = useState(false);
  const [pricingError, setPricingError] = useState<string | null>(null);
  const [manualAllowed, setManualAllowed] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
  const [prohibitedReason, setProhibitedReason] = useState<string | null>(null);

  const [form, setForm] = useState<Form>(EMPTY_FORM);
  const [listing, setListing] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  useEffect(() => {
    if (!previewUrl) return;
    return () => URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  function update<K extends keyof Form>(key: K, value: Form[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    setPreparing(true);
    setPhotoError(null);
    setPricingError(null);
    setManualAllowed(false);
    setShowForm(false);
    setSuggestion(null);
    setProhibitedReason(null);
    setListError(null);
    setFieldErrors({});
    setForm(EMPTY_FORM);
    try {
      const prepared = await downscaleImage(file);
      uploadedRef.current = null;
      setPhoto(prepared);
      setPreviewUrl(URL.createObjectURL(prepared.blob));
    } catch (error) {
      setPhotoError(error instanceof PhotoPrepError ? error.message : "We could not read that photo. Try another one.");
    } finally {
      setPreparing(false);
    }
  }

  async function priceIt() {
    if (!photo) return;
    setPricing(true);
    setPricingError(null);
    setManualAllowed(false);
    try {
      const response = await fetch("/api/pricing", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ imageBase64: photo.base64, mediaType: "image/jpeg" }),
      });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        setPricingError(pricingErrorMessage(response.status, errorCode(body)));
        setManualAllowed(pricingAllowsManualEntry(response.status));
        return;
      }
      const draft = ListingDraft.safeParse(body);
      if (!draft.success) {
        setPricingError(pricingErrorMessage(502));
        setManualAllowed(true);
        return;
      }
      const value = draft.data;
      if (value.prohibited_flag) {
        setProhibitedReason(value.prohibited_reason ?? "This looks like something that cannot be sold here.");
        setShowForm(false);
        return;
      }
      setSuggestion({
        priceLow: value.price_low,
        priceHigh: value.price_high,
        priceReason: value.price_reason,
        confidenceNote: value.confidence_note,
      });
      setForm({
        title: value.title,
        description: value.description,
        category: value.category,
        condition: value.condition,
        price: priceToInput(value.price_suggested),
      });
      setShowForm(true);
    } catch {
      setPricingError("We could not reach the server. Check your connection and try again.");
      setManualAllowed(true);
    } finally {
      setPricing(false);
    }
  }

  function fillInMyself() {
    setPricingError(null);
    setManualAllowed(false);
    setShowForm(true);
  }

  async function uploadPhoto(prepared: PreparedPhoto): Promise<string> {
    if (uploadedRef.current?.blob === prepared.blob) return uploadedRef.current.path;
    const path = photoPathFor(householdId, crypto.randomUUID());
    const supabase = createSupabaseBrowserClient();
    const { error } = await supabase.storage
      .from(PHOTO_BUCKET)
      .upload(path, prepared.blob, { contentType: "image/jpeg", cacheControl: "31536000", upsert: false });
    if (error) throw new Error("upload");
    uploadedRef.current = { blob: prepared.blob, path };
    return path;
  }

  async function listIt(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!photo || prohibitedReason) return;
    setListing(true);
    setListError(null);
    setFieldErrors({});

    let photoPath: string;
    try {
      photoPath = await uploadPhoto(photo);
    } catch {
      setListError("We could not upload the photo. Check your connection and try again. Your details are still here.");
      setListing(false);
      return;
    }

    try {
      const result = await createItem({
        householdId,
        photoPath,
        title: form.title,
        description: form.description,
        category: form.category,
        condition: form.condition,
        price: form.price,
        priceLow: suggestion?.priceLow ?? null,
        priceHigh: suggestion?.priceHigh ?? null,
        priceReason: suggestion?.priceReason ?? null,
      });
      if (!result.ok) {
        setListError(result.error);
        setFieldErrors(result.fieldErrors ?? {});
        setListing(false);
        return;
      }
      router.push(`/seller${householdQuery(householdId)}`);
      router.refresh();
    } catch {
      setListError("We could not reach the server. Check your connection and try again. Your details are still here.");
      setListing(false);
    }
  }

  const fileInputs = (
    <>
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => {
          void onFile(event.target.files?.[0]);
          event.target.value = "";
        }}
      />
      <input
        ref={libraryRef}
        type="file"
        accept="image/*"
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => {
          void onFile(event.target.files?.[0]);
          event.target.value = "";
        }}
      />
    </>
  );

  const busy = preparing || pricing || listing;

  return (
    <div className="flex flex-col gap-5">
      {fileInputs}

      <Card padding="md" className="flex flex-col gap-4">
        {previewUrl ? (
          <ItemPhoto src={previewUrl} alt="Your photo" sizes="(min-width: 640px) 36rem, 100vw" className="w-full" />
        ) : (
          <div className="flex aspect-square w-full flex-col items-center justify-center gap-2 rounded-field border border-dashed border-grey-300 bg-paper-deep px-6 text-center">
            {preparing ? (
              <Spinner size="lg" label="Getting your photo ready" />
            ) : (
              <>
                <p className="font-display text-lg font-semibold text-ink">Start with a photo</p>
                <p className="text-sm text-ink-soft">One clear photo in good light. We suggest a name and a price.</p>
              </>
            )}
          </div>
        )}

        {photoError ? <Notice tone="danger">{photoError}</Notice> : null}

        {!photo ? (
          <div className="flex flex-col gap-2">
            <Button variant="primary" size="lg" fullWidth loading={preparing} onClick={() => cameraRef.current?.click()}>
              Take a photo
            </Button>
            <Button variant="ghost" fullWidth disabled={preparing} onClick={() => libraryRef.current?.click()}>
              Choose from your photos
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {!showForm && !prohibitedReason ? (
              <Button variant="primary" size="lg" fullWidth loading={pricing} onClick={priceIt}>
                {pricing ? "Looking at your photo" : "Price it"}
              </Button>
            ) : null}
            <Button variant="ghost" fullWidth loading={preparing} disabled={busy} onClick={() => cameraRef.current?.click()}>
              Take a different photo
            </Button>
          </div>
        )}

        {pricingError ? (
          <div className="flex flex-col gap-2">
            <Notice tone="danger">{pricingError}</Notice>
            {manualAllowed ? (
              <Button variant="secondary" fullWidth onClick={fillInMyself}>
                Fill in the details myself
              </Button>
            ) : null}
          </div>
        ) : null}
      </Card>

      {prohibitedReason ? (
        <Card tone="sunken" padding="md" className="flex flex-col gap-2" role="alert">
          <CardTitle as="h2">This cannot be listed</CardTitle>
          <p className="text-sm text-ink">{prohibitedReason}</p>
          <p className="text-sm text-ink-soft">Items like this cannot be paid for through checkout. Try a different item.</p>
        </Card>
      ) : null}

      {showForm && !prohibitedReason ? (
        <form onSubmit={listIt} noValidate className="flex flex-col gap-4">
          <Card padding="md" className="flex flex-col gap-4">
            <CardTitle as="h2">Check the details</CardTitle>
            {suggestion ? (
              <p className="text-sm text-ink-soft">{suggestion.confidenceNote} Change anything that looks wrong.</p>
            ) : null}

            <Field label="Name" error={fieldErrors.title} required>
              <Input
                name="title"
                value={form.title}
                maxLength={MAX_TITLE_LENGTH}
                onChange={(event) => update("title", event.target.value)}
              />
            </Field>

            <Field
              label="Price"
              hint={
                suggestion
                  ? `We suggest ${formatMoney(suggestion.priceLow, { trimWholeDollars: true })} to ${formatMoney(suggestion.priceHigh, { trimWholeDollars: true })}. ${suggestion.priceReason}`
                  : "In dollars, like 5 or 12.50."
              }
              error={fieldErrors.price}
              required
            >
              <Input
                name="price"
                inputMode="decimal"
                autoComplete="off"
                value={form.price}
                onChange={(event) => update("price", event.target.value)}
              />
            </Field>

            <SelectField
              label="Category"
              name="category"
              value={form.category}
              options={LISTING_CATEGORIES}
              labels={CATEGORY_LABELS}
              error={fieldErrors.category}
              onChange={(value) => update("category", value)}
            />

            <SelectField
              label="Condition"
              name="condition"
              value={form.condition}
              options={LISTING_CONDITIONS}
              labels={CONDITION_LABELS}
              error={fieldErrors.condition}
              onChange={(value) => update("condition", value)}
            />

            <Field label="Description" error={fieldErrors.description} optional>
              <Textarea
                name="description"
                rows={3}
                maxLength={MAX_DESCRIPTION_LENGTH}
                value={form.description}
                onChange={(event) => update("description", event.target.value)}
              />
            </Field>
          </Card>

          {listError ? <Notice tone="danger">{listError}</Notice> : null}
          {fieldErrors.photoPath ? <Notice tone="danger">{fieldErrors.photoPath}</Notice> : null}

          <Button type="submit" variant="primary" size="lg" fullWidth loading={listing}>
            {listing ? "Listing your item" : "List it"}
          </Button>
        </form>
      ) : null}
    </div>
  );
}
