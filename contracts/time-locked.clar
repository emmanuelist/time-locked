;; Time-Locked Yield Vault - Production Standard Contract
;; Follows Stacks best practices and Clarity 4 standards
;; Uses burn-block-height for stable Bitcoin-anchored timing

;; ========================================
;; Constants
;; ========================================

(define-constant contract-owner tx-sender)
(define-constant err-owner-only (err u100))
(define-constant err-not-found (err u101))
(define-constant err-insufficient-balance (err u102))
(define-constant err-lock-period-not-met (err u103))
(define-constant err-already-exists (err u104))
(define-constant err-invalid-amount (err u105))
(define-constant err-vault-paused (err u106))
(define-constant err-invalid-lock-period (err u107))
(define-constant err-zero-amount (err u108))
(define-constant err-same-sender-recipient (err u109))
(define-constant err-insufficient-vault-balance (err u110))

;; Lock period tiers (in Bitcoin blocks, ~10 min per block)
;; Using Bitcoin blocks for stability across Stacks upgrades
(define-constant short-lock-blocks u4320)    ;; ~30 days
(define-constant medium-lock-blocks u8640)   ;; ~60 days  
(define-constant long-lock-blocks u17280)    ;; ~120 days

;; Yield multipliers (basis points, 100 = 1%)
(define-constant short-lock-multiplier u500)   ;; 5% APY
(define-constant medium-lock-multiplier u1000) ;; 10% APY
(define-constant long-lock-multiplier u1500)   ;; 15% APY

;; Maximum deposit to prevent overflow
(define-constant max-deposit u1000000000000) ;; 1M STX in micro-STX

;; ========================================
;; Data Variables
;; ========================================

(define-data-var vault-paused bool false)
(define-data-var total-locked uint u0)
(define-data-var total-yield-distributed uint u0)
(define-data-var vault-creation-height uint u0)

;; ========================================
;; Data Maps
;; ========================================

;; User deposits with Bitcoin block-height based time-lock
(define-map deposits
  { user: principal }
  {
    amount: uint,
    lock-period: uint,
    deposit-height: uint,
    unlock-height: uint,
    yield-rate: uint,
    withdrawn: bool
  }
)

;; Track total deposits per user
(define-map user-stats
  { user: principal }
  {
    total-deposited: uint,
    total-withdrawn: uint,
    total-yield-earned: uint,
    deposit-count: uint
  }
)

;; ========================================
;; Clarity 4 Feature: Bitcoin Block Height
;; Using burn-block-height for stability
;; ========================================

;; Get current Bitcoin block height (more stable than Stacks block-height)
(define-read-only (get-current-burn-height)
  burn-block-height
)

;; Check if lock period has expired using Bitcoin blocks
(define-read-only (is-lock-expired (user principal))
  (match (map-get? deposits { user: user })
    deposit (>= burn-block-height (get unlock-height deposit))
    false
  )
)

;; Calculate Bitcoin blocks remaining in lock period
(define-read-only (get-blocks-remaining (user principal))
  (match (map-get? deposits { user: user })
    deposit 
      (if (>= burn-block-height (get unlock-height deposit))
        u0
        (- (get unlock-height deposit) burn-block-height)
      )
    u0
  )
)

;; ========================================
;; Read-Only Functions
;; ========================================

(define-read-only (get-deposit-info (user principal))
  (ok (map-get? deposits { user: user }))
)

(define-read-only (get-user-stats (user principal))
  (ok (map-get? user-stats { user: user }))
)

(define-read-only (get-vault-stats)
  (ok {
    total-locked: (var-get total-locked),
    total-yield-distributed: (var-get total-yield-distributed),
    vault-paused: (var-get vault-paused),
    current-burn-height: burn-block-height,
    creation-height: (var-get vault-creation-height)
  })
)

;; Calculate yield earned based on Bitcoin blocks elapsed
(define-read-only (calculate-yield (user principal))
  (match (map-get? deposits { user: user })
    deposit
      (let
        (
          (amount (get amount deposit))
          (yield-rate (get yield-rate deposit))
          (blocks-locked (- burn-block-height (get deposit-height deposit)))
          (lock-period (get lock-period deposit))
        )
        ;; Prevent division by zero
        (asserts! (> lock-period u0) err-invalid-lock-period)
        ;; Yield = (amount * yield-rate * blocks-locked) / (lock-period * 10000)
        (ok (/ (* (* amount yield-rate) blocks-locked) (* lock-period u10000)))
      )
    (err err-not-found)
  )
)