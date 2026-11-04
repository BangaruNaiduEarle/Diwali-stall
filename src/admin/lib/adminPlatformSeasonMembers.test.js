import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  canMutatePlatformSeasonMemberships,
  isDuplicatePlatformSeasonMembershipMessage,
  isLastActiveSeasonOwnerMessage,
  mergePlatformSeasonMemberIntoList,
  parsePlatformSeasonMember,
  platformSeasonMemberMutationActions,
  validatePlatformSeasonMemberAssignForm,
} from './adminPlatformSeasonMembers.js'

describe('adminPlatformSeasonMembers', () => {
  it('parses members including disabled membership state', () => {
    const parsed = parsePlatformSeasonMember({
      userId: 'u-staff',
      email: 'staff@example.com',
      role: 'admin',
      membershipDisabled: true,
      userDisabled: false,
      createdAt: '2026-01-01',
    })
    assert.ok(parsed)
    assert.equal(parsed.membershipDisabled, true)
    assert.equal(parsed.userDisabled, false)
  })

  it('validates assign form with default owner role', () => {
    const fail = validatePlatformSeasonMemberAssignForm({ email: 'bad', role: 'owner' })
    assert.equal(fail.ok, false)

    const ok = validatePlatformSeasonMemberAssignForm({ email: ' Owner@Example.com ', role: 'owner' })
    assert.equal(ok.ok, true)
    if (ok.ok) {
      assert.equal(ok.email, 'owner@example.com')
      assert.equal(ok.role, 'owner')
    }
  })

  it('merges member updates after role change or enable/disable', () => {
    const initial = [
      parsePlatformSeasonMember({
        userId: 'u-1',
        email: 'a@example.com',
        role: 'owner',
        membershipDisabled: false,
        userDisabled: false,
      }),
    ].filter(Boolean)
    assert.equal(initial.length, 1)

    const updated = parsePlatformSeasonMember({
      userId: 'u-1',
      email: 'a@example.com',
      role: 'super_admin',
      membershipDisabled: true,
      userDisabled: false,
    })
    const merged = mergePlatformSeasonMemberIntoList(initial, /** @type {NonNullable<typeof updated>} */ (updated))
    assert.equal(merged.length, 1)
    assert.equal(merged[0].role, 'super_admin')
    assert.equal(merged[0].membershipDisabled, true)
  })

  it('recognizes duplicate membership and last owner API errors', () => {
    assert.equal(isDuplicatePlatformSeasonMembershipMessage('This user is already a member of the season.'), true)
    assert.equal(isLastActiveSeasonOwnerMessage('At least one active season owner must remain.'), true)
  })

  it('blocks membership mutations on archived seasons but allows read', () => {
    assert.equal(canMutatePlatformSeasonMemberships('archived'), false)
    assert.equal(canMutatePlatformSeasonMemberships('active'), true)

    const archivedActions = platformSeasonMemberMutationActions('archived')
    assert.equal(archivedActions.canAssign, false)
    assert.equal(archivedActions.canToggleMembership, false)
    assert.equal(archivedActions.canDisableLoginGlobally, false)

    const activeActions = platformSeasonMemberMutationActions('active')
    assert.equal(activeActions.canAssign, true)
    assert.equal(activeActions.canChangeRole, true)
  })
})
