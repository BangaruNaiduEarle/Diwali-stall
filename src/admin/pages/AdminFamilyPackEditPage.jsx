import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import Button from '../../components/ui/Button.jsx'
import {
  createAdminFamilyPack,
  deleteAdminFamilyPack,
  fetchAdminFamilyPack,
  patchAdminFamilyPackStatus,
  updateAdminFamilyPack,
} from '../api/adminApi.js'
import AdminConfirmDialog from '../components/AdminConfirmDialog.jsx'
import AdminFeedbackBanner from '../components/AdminFeedbackBanner.jsx'
import FamilyPackForm, { emptyFamilyPackFormValues, familyPackToFormValues } from '../components/FamilyPackForm.jsx'
import {
  effectiveFamilyPackId,
  familyPackSaveTarget,
  shouldNavigateToEditAfterImagePersist,
} from '../lib/adminFamilyPackEditMode.js'
import { assertFamilyPackSaveNotBlockedByImages } from '../lib/adminFamilyPackImageSave.js'
import { buildFamilyPackPayload, buildFamilyPackPersistPayload } from '../lib/adminFamilyPackPayload.js'
import {
  validateFamilyPackFormValues,
  validateFamilyPackFormValuesForUploadDraft,
} from '../lib/adminFamilyPackFormValidation.js'
import { adminNavigationFlashState } from '../lib/adminNavigationFlash.js'
import { useAdminFlash } from '../lib/useAdminFlash.js'

const FP_ID_RE = /^FP\d{3,}$/

/** @param {boolean} active */
function StatusBadge({ active }) {
  return (
    <span className={`admin-badge${active ? '' : ' admin-badge--muted'}`}>{active ? 'Active' : 'Inactive'}</span>
  )
}

export default function AdminFamilyPackEditPage() {
  const { id: routeId } = useParams()
  const isCreate = routeId == null
  const packId = isCreate ? null : String(routeId ?? '').trim()
  const navigate = useNavigate()
  const { flash, setFlash, clearFlash } = useAdminFlash()

  const [values, setValues] = useState(emptyFamilyPackFormValues)
  const [loading, setLoading] = useState(!isCreate)
  const [loadError, setLoadError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [serverError, setServerError] = useState('')
  const [serverFields, setServerFields] = useState(/** @type {Record<string, string> | null} */ (null))
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  /** Draft pack created from /new for uploads — kept until URL catches up after persist. */
  const [draftPackId, setDraftPackId] = useState(/** @type {string | null} */ (null))
  const draftPackIdRef = useRef(/** @type {string | null} */ (null))
  const uploadCoordinatorRef = useRef(
    /** @type {{ waitUntilIdle: () => Promise<void>, isBusy: () => boolean } | null} */ (null),
  )
  const [imageUploadBusy, setImageUploadBusy] = useState(false)

  const effectivePackId = effectiveFamilyPackId(packId, draftPackId)

  function rememberDraftPackId(id) {
    const next = String(id ?? '').trim()
    if (!FP_ID_RE.test(next)) return
    draftPackIdRef.current = next
    setDraftPackId(next)
  }

  useEffect(() => {
    if (isCreate) return
    if (!FP_ID_RE.test(packId)) {
      setLoadError('Invalid family pack id in URL.')
      setLoading(false)
      return
    }
    let cancelled = false
    fetchAdminFamilyPack(packId).then((result) => {
      if (cancelled) return
      if (!result.ok) {
        setLoadError(result.message)
        setLoading(false)
        return
      }
      setValues(familyPackToFormValues(result.familyPack))
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [isCreate, packId])

  async function ensureFamilyPackForUpload() {
    const existingId = effectiveFamilyPackId(packId, draftPackIdRef.current ?? draftPackId)
    if (existingId) return { ok: true, familyPackId: existingId }
    if (submitting) return { ok: false, message: 'Save is already in progress.' }

    const clientValidation = validateFamilyPackFormValuesForUploadDraft(values)
    if (!clientValidation.ok) {
      setServerFields(clientValidation.fields)
      setServerError('Enter pack name and selling price before uploading images.')
      return { ok: false, message: 'Enter pack name and selling price before uploading images.' }
    }

    const payload = buildFamilyPackPersistPayload(values)
    if (!payload.items?.length) payload.items = []
    const result = await createAdminFamilyPack(payload)
    if (!result.ok) {
      setServerFields(result.fields ?? null)
      const fieldMsg = result.fields ? Object.values(result.fields).join(' ') : ''
      setServerError(fieldMsg || result.message || 'Could not create pack for upload.')
      return { ok: false, message: fieldMsg || result.message || 'Could not create pack for upload.' }
    }
    const created = /** @type {{ familyPack?: { id?: string } } | null} */ (result.data ?? null)?.familyPack
    if (!created?.id) return { ok: false, message: 'Could not create pack for upload.' }
    rememberDraftPackId(String(created.id))
    return { ok: true, familyPackId: String(created.id) }
  }

  async function handleSave() {
    if (submitting) return
    setServerError('')
    setServerFields(null)
    clearFlash()

    await uploadCoordinatorRef.current?.waitUntilIdle()
    const imageGate = assertFamilyPackSaveNotBlockedByImages({
      uploading: uploadCoordinatorRef.current?.isBusy() ?? imageUploadBusy,
      images: values.images,
    })
    if (!imageGate.ok) {
      setServerError(imageGate.message)
      return
    }

    const clientValidation = validateFamilyPackFormValues(values, { isCreate })
    if (!clientValidation.ok) {
      setServerFields(clientValidation.fields)
      setServerError('Fix the highlighted fields before saving.')
      return
    }

    setSubmitting(true)
    const payload = buildFamilyPackPayload(values)
    const target = familyPackSaveTarget({
      isCreateRoute: isCreate,
      routePackId: packId,
      draftPackId: draftPackIdRef.current ?? draftPackId,
    })
    const result =
      target.mode === 'create'
        ? await createAdminFamilyPack(payload)
        : await updateAdminFamilyPack(target.id, payload)
    setSubmitting(false)
    if (!result.ok) {
      setServerError(result.message || 'Could not save family pack.')
      setServerFields(result.fields ?? null)
      return
    }
    const saved = /** @type {{ familyPack?: { id?: string } } | null} */ (result.data ?? null)?.familyPack
    if (saved) setValues(familyPackToFormValues(saved))
    if (saved?.id) rememberDraftPackId(String(saved.id))
    if (isCreate && saved?.id) {
      navigate(`/admin/family-packs/${saved.id}/edit`, {
        replace: true,
        state: adminNavigationFlashState(
          target.mode === 'create' ? 'Family pack created successfully.' : 'Family pack saved successfully.',
        ),
      })
      return
    }
    setFlash({ type: 'success', message: 'Changes saved successfully.' })
  }

  async function handleStatus(active) {
    if (!packId || submitting) return
    clearFlash()
    const result = await patchAdminFamilyPackStatus(packId, active)
    if (result.ok && result.data?.familyPack) {
      setValues(familyPackToFormValues(result.data.familyPack))
      setFlash({
        type: 'success',
        message: active ? 'Family pack activated.' : 'Family pack deactivated.',
      })
    } else {
      setServerError(result.message || 'Could not update status.')
    }
  }

  /**
   * @param {{ url: string, sortOrder: number, isCover: boolean }[]} images
   * @param {{ familyPackId?: string }} [opts]
   */
  async function persistImages(images, opts = {}) {
    const targetId =
      opts.familyPackId ?? effectiveFamilyPackId(packId, draftPackIdRef.current ?? draftPackId)
    if (!targetId) {
      return { ok: false, message: 'Save the pack before uploading images.' }
    }
    const payload = opts.formSnapshot
      ? buildFamilyPackPersistPayload(opts.formSnapshot, images)
      : buildFamilyPackPersistPayload(values, images)
    const result = await updateAdminFamilyPack(targetId, payload)
    if (!result.ok) {
      const fieldMsg = result.fields ? Object.values(result.fields).join(' ') : ''
      return { ok: false, message: fieldMsg || result.message || 'Could not save images.' }
    }
    const saved = /** @type {{ familyPack?: unknown } | null} */ (result.data ?? null)?.familyPack
    if (saved) setValues(familyPackToFormValues(saved))
    return { ok: true }
  }

  async function handleDeleteConfirm() {
    if (!packId || deleting) return
    setDeleting(true)
    setServerError('')
    const result = await deleteAdminFamilyPack(packId)
    setDeleting(false)
    if (!result.ok) {
      setDeleteOpen(false)
      setServerError(result.message || 'Could not delete family pack.')
      return
    }
    navigate('/admin/family-packs', { replace: true })
  }

  const pageTitle = isCreate ? 'Create Family Pack' : 'Edit Family Pack'
  const subtitle = useMemo(() => {
    if (isCreate) {
      return 'Enter name and selling price to upload images (draft pack). Add included items before Create or activating on the site.'
    }
    return 'Update pack details, images, and included products. Changes apply to new estimates after save.'
  }, [isCreate])

  if (loading) {
    return <p className="admin-page text-sm text-[var(--color-muted)]">Loading family pack…</p>
  }

  if (loadError) {
    return (
      <div className="admin-page">
        <p className="text-sm text-[var(--color-red)]" role="alert">
          {loadError}
        </p>
        <Link to="/admin/family-packs" className="mt-4 inline-block text-sm font-semibold text-[var(--color-maroon)]">
          ← Back to family packs
        </Link>
      </div>
    )
  }

  return (
    <div className="admin-page admin-page--family-pack-edit">
      <header className="admin-page__header">
        <div className="min-w-0 flex-1">
          <Link to="/admin/family-packs" className="text-sm font-semibold text-[var(--color-maroon)]">
            ← Back to family packs
          </Link>
          <p className="admin-page__eyebrow mt-3">Family packs</p>
          <h1 className="admin-page__title">{pageTitle}</h1>
          <p className="admin-page__subtitle mt-1 text-sm text-[var(--color-muted)]">{subtitle}</p>
          {!isCreate ? (
            <div className="admin-family-pack-edit__header-meta">
              <span className="text-sm text-[var(--color-muted)]">
                ID: <span className="font-mono text-[var(--color-charcoal)]">{packId}</span>
              </span>
              <StatusBadge active={values.active} />
            </div>
          ) : null}
        </div>
      </header>

      <AdminFeedbackBanner variant={flash?.type ?? 'success'} message={flash?.message} onDismiss={clearFlash} />

      {serverError ? (
        <AdminFeedbackBanner variant="error" message={serverError} onDismiss={() => setServerError('')} className="mt-4" />
      ) : null}

      <FamilyPackForm
        values={values}
        onChange={(next) => {
          setValues(next)
          setServerFields(null)
          if (serverError) setServerError('')
        }}
        fieldErrors={serverFields}
        familyPackId={effectivePackId}
        onEnsureFamilyPack={ensureFamilyPackForUpload}
        onPersistImages={persistImages}
        uploadCoordinatorRef={uploadCoordinatorRef}
        onUploadBusyChange={setImageUploadBusy}
        disabled={submitting}
        isCreateRoute={isCreate}
        onImagesSaved={() => {
          setFlash({ type: 'success', message: 'Images uploaded to Cloudinary and saved to this pack.' })
          const draft = draftPackIdRef.current ?? draftPackId
          if (shouldNavigateToEditAfterImagePersist(isCreate, packId, draft)) {
            navigate(`/admin/family-packs/${draft}/edit`, {
              replace: true,
              state: adminNavigationFlashState('Images saved. You can add more photos or save other changes.'),
            })
          }
        }}
      />

      <div className="admin-form-sticky-footer" role="group" aria-label="Form actions">
        <div className="admin-form-sticky-footer__primary flex flex-wrap gap-2">
          <Button
            type="button"
            variant="primary"
            loading={submitting}
            disabled={submitting || imageUploadBusy}
            onClick={handleSave}
          >
            {submitting
              ? isCreate
                ? 'Creating…'
                : 'Saving changes…'
              : isCreate
                ? 'Create family pack'
                : 'Save changes'}
          </Button>
          <Button type="button" variant="secondary" disabled={submitting} to="/admin/family-packs">
            Cancel
          </Button>
        </div>
        {!isCreate ? (
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={submitting || deleting}
              onClick={() => handleStatus(!values.active)}
            >
              {values.active ? 'Deactivate now' : 'Activate now'}
            </Button>
            {values.slug ? (
              <Button to={`/packs/${values.slug}`} variant="ghost" size="sm" target="_blank">
                Preview
              </Button>
            ) : null}
            <Button type="button" variant="ghost" size="sm" disabled={submitting || deleting} onClick={() => setDeleteOpen(true)}>
              Delete
            </Button>
          </div>
        ) : null}
      </div>

      <AdminConfirmDialog
        open={deleteOpen}
        title={`Delete “${values.name.trim() || packId}”?`}
        description="Permanent deletion cannot be undone. Images and pack contents will be removed from the database. If customer requests reference this pack, deletion will be blocked — deactivate the pack instead."
        cancelLabel="Keep pack"
        confirmLabel="Delete permanently"
        confirming={deleting}
        onCancel={() => {
          if (!deleting) setDeleteOpen(false)
        }}
        onConfirm={handleDeleteConfirm}
      />
    </div>
  )
}
