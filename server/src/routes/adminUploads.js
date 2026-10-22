import { readJsonBody, validationErrorResponse, JSON_HEADERS } from '../lib/http.js'
import { isValidProductId, parseJsonObject } from '../lib/validation.js'
import { isValidFamilyPackId } from '../lib/familyPackValidation.js'
import {
  buildFamilyPackUploadTarget,
  buildProductUploadTarget,
  normalizeUploadSlot,
  readCloudinaryConfig,
  signCloudinaryParams,
} from '../lib/cloudinarySign.js'

const NO_STORE = { ...JSON_HEADERS, 'Cache-Control': 'no-store' }

/**
 * POST /api/admin/uploads/sign — signed Cloudinary direct-upload params.
 * Auth is enforced by requireAdmin in index.js before this handler runs.
 * @param {Request} request
 * @param {Record<string, unknown>} env
 */
export async function handleAdminUploadSign(request, env) {
  const config = readCloudinaryConfig(env)
  if (!config) {
    return Response.json(
      {
        error: 'cloudinary_not_configured',
        message: 'Cloudinary is not configured.',
      },
      { status: 503, headers: NO_STORE },
    )
  }

  const parsed = await readJsonBody(request)
  if (!parsed.ok) {
    return Response.json(
      { error: parsed.error, message: parsed.message },
      { status: parsed.status, headers: { 'Cache-Control': 'no-store' } },
    )
  }
  const body = parseJsonObject(parsed.value)
  if (!body.ok) return validationErrorResponse(body.errors)

  const familyPackId = String(body.data.familyPackId ?? body.data.family_pack_id ?? '').trim()
  const productId = String(body.data.productId ?? body.data.product_id ?? '').trim()

  const slot = normalizeUploadSlot(body.data.slot)
  if (!slot.ok) {
    return validationErrorResponse({ slot: 'slot must be an integer from 1 to 20.' })
  }

  let folder
  let publicId
  if (familyPackId) {
    if (productId) {
      return validationErrorResponse({ _body: 'Provide productId or familyPackId, not both.' })
    }
    if (!isValidFamilyPackId(familyPackId)) {
      return validationErrorResponse({ familyPackId: 'Invalid family pack id (expected FP###).' })
    }
    ;({ folder, publicId } = buildFamilyPackUploadTarget(familyPackId, slot.value))
  } else {
    if (!isValidProductId(productId)) {
      return validationErrorResponse({ productId: 'Invalid product id (expected P###).' })
    }
    ;({ folder, publicId } = buildProductUploadTarget(productId, slot.value))
  }
  const timestamp = Math.floor(Date.now() / 1000)
  const paramsToSign = {
    folder,
    overwrite: true,
    public_id: publicId,
    timestamp,
  }
  const signature = await signCloudinaryParams(paramsToSign, config.apiSecret)

  return Response.json(
    {
      cloudName: config.cloudName,
      apiKey: config.apiKey,
      timestamp,
      signature,
      folder,
      publicId,
    },
    { status: 200, headers: NO_STORE },
  )
}
