import { getAdminRequestContext } from '../api/adminSeasonRequest.js'

// One-use, in-memory navigation handoff. Never persist private prices in history.
let saved = null

export function rememberCreatedProduct(product, categories, context) {
  if (context.generation !== getAdminRequestContext().generation) return
  saved = { product, categories, generation: context.generation, expires: Date.now() + 30000 }
}

export function takeCreatedProduct(id) {
  const result = saved
  saved = null
  if (!result || result.product?.id !== id || result.expires < Date.now() ||
      result.generation !== getAdminRequestContext().generation) return null
  return result
}
