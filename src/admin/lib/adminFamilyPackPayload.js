import { isPersistableFamilyPackImageUrl } from './adminImageUploadFlow.js'
import { normalizeAdminProductIdInput } from './adminFamilyPackFormValidation.js'

/**
 * @param {import('../components/FamilyPackForm.jsx').FamilyPackFormValues} values
 */
export function buildFamilyPackPayload(values) {
  return {
    name: values.name.trim(),
    slug: values.slug.trim(),
    shortDescription: values.shortDescription.trim(),
    sellingPriceInr: values.sellingPriceInr.trim(),
    packLabel: values.packLabel.trim() || null,
    sortOrder: Number(values.sortOrder) || 0,
    active: values.active,
    images: values.images
      .filter((img) => isPersistableFamilyPackImageUrl(img.url))
      .map((img, index) => ({
        url: img.url,
        sortOrder: index,
        isCover: img.isCover,
      })),
    items: values.items
      .filter((row) => row.productId.trim())
      .map((row, index) => ({
        productId: normalizeAdminProductIdInput(row.productId),
        quantity: Number(row.quantity) || 1,
        unitLabel: row.unitLabel.trim(),
        sortOrder: index,
      })),
  }
}

/**
 * PUT payload for family pack save / image persist.
 * Omits `items` when the form has no product rows so image-only updates do not wipe pack contents.
 *
 * @param {import('../components/FamilyPackForm.jsx').FamilyPackFormValues} values
 * @param {{ url: string, sortOrder: number, isCover: boolean }[]} [imagesOverride]
 */
export function buildFamilyPackPersistPayload(values, imagesOverride) {
  const payload = buildFamilyPackPayload(
    imagesOverride != null ? { ...values, images: imagesOverride } : values,
  )
  const hasPersistedItems = (values.items ?? []).some((row) => String(row.productId ?? '').trim())
  if (!hasPersistedItems) {
    delete payload.items
  }
  return payload
}
