import { readJsonBody, validationErrorResponse, JSON_HEADERS } from '../lib/http.js'
import { isValidProductId, parseJsonObject } from '../lib/validation.js'
import { isValidFamilyPackId } from '../lib/familyPackValidation.js'
import { requireWritableSeason } from '../middleware/adminSeasonGuards.js'
import { adminLocationMode } from '../lib/adminServiceMode.js'
import {
  buildFamilyPackUploadTarget,
  buildProductUploadTarget,
  normalizeUploadSlot,
  readCloudinaryConfig,
  signCloudinaryParams,
} from '../lib/cloudinarySign.js'

const NO_STORE = { ...JSON_HEADERS, 'Cache-Control': 'no-store' }

const FAMILY_PACK_UPLOAD_OWNERSHIP_SQL = `
  SELECT id FROM family_packs WHERE id = ? AND season_id = ?
`.trim()

const PRODUCT_UPLOAD_OWNERSHIP_SQL = `
  SELECT id FROM products WHERE id = ? AND season_id = ?
`.trim()

/** @param {{ ok: false, status: number, code: string, message: string }} guard */
function uploadGuardForbiddenResponse(guard) {
  return Response.json(
    { error: guard.code, message: guard.message },
    { status: guard.status, headers: NO_STORE },
  )
}

/**
 * POST /api/admin/uploads/sign — signed Cloudinary direct-upload params.
 * Auth is enforced by requireAdmin in index.js before this handler runs.
 * @param {Request} request
 * @param {Record<string, unknown>} env
 */
export async function handleAdminUploadSign(request, env) {
  // Legacy target lookups are season-only. Do not issue signatures in location mode.
  // Invalid mode configuration also fails closed; only a parsed OFF value proceeds.
  if (adminLocationMode(env) !== false) {
    return Response.json(
      { error: 'upload_signing_disabled', message: 'Image upload signing is disabled in location mode.' },
      { status: 403, headers: NO_STORE },
    )
  }
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

    const access = requireWritableSeason(request)
    if (!access.ok) {
      return uploadGuardForbiddenResponse(access)
    }
    const seasonId = access.auth.activeSeasonId

    const packRow = await env.DB.prepare(FAMILY_PACK_UPLOAD_OWNERSHIP_SQL)
      .bind(familyPackId, seasonId)
      .first()
    if (!packRow) {
      return Response.json(
        { error: 'not_found', message: 'Family pack not found.' },
        { status: 404, headers: NO_STORE },
      )
    }

    ;({ folder, publicId } = buildFamilyPackUploadTarget(familyPackId, slot.value))
  } else {
    if (!isValidProductId(productId)) {
      return validationErrorResponse({ productId: 'Invalid product id (expected P###).' })
    }

    const access = requireWritableSeason(request)
    if (!access.ok) {
      return uploadGuardForbiddenResponse(access)
    }
    const seasonId = access.auth.activeSeasonId

    const productRow = await env.DB.prepare(PRODUCT_UPLOAD_OWNERSHIP_SQL)
      .bind(productId, seasonId)
      .first()
    if (!productRow) {
      return Response.json(
        { error: 'not_found', message: 'Product not found.' },
        { status: 404, headers: NO_STORE },
      )
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
