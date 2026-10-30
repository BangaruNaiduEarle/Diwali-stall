import { isLocalPreviewUrl } from './adminImageUploadFlow.js'
import {
  finalPriceInrForProductWrite,
  sellingPriceInrForProductWrite,
} from './adminProductSellingPricePayload.js'

/**
 * @param {import('../components/ProductForm.jsx').ProductFormValues} values
 * @param {{ includeSellingPrice?: boolean, includeFinalPrice?: boolean }} [opts]
 */
export function buildProductPayload(values, opts = {}) {
  const payload = {
    id: values.id,
    categorySlug: values.categorySlug,
    name: values.name,
    company: String(values.company ?? '').trim() || null,
    pack: values.pack,
    description: values.description,
    featured: values.featured,
    stockStatus: values.stockStatus,
    active: values.active,
    sortOrder: values.sortOrder,
    images: (values.images ?? []).filter((url) => {
      const s = String(url ?? '').trim()
      return s && !isLocalPreviewUrl(s)
    }),
  }
  if (opts.includeSellingPrice) {
    const sellingInr = sellingPriceInrForProductWrite(values)
    if (sellingInr !== undefined) {
      payload.sellingPriceInr = sellingInr
    }
  }
  if (opts.includeFinalPrice) {
    const finalInr = finalPriceInrForProductWrite(values)
    if (finalInr !== undefined) {
      payload.finalPriceInr = finalInr
    }
  }
  return payload
}
