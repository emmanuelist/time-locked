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

;; Check if user has active deposit
(define-read-only (has-active-deposit (user principal))
  (match (map-get? deposits { user: user })
    deposit (not (get withdrawn deposit))
    false
  )
)

;; Get vault's STX balance
(define-read-only (get-vault-balance)
  (ok (stx-get-balance (as-contract tx-sender)))
)

;; ========================================
;; Public Functions - Core Vault Logic
;; ========================================

;; Initialize vault (called once by deployer)
(define-public (initialize-vault)
  (begin
    (asserts! (is-eq tx-sender contract-owner) err-owner-only)
    (asserts! (is-eq (var-get vault-creation-height) u0) err-already-exists)
    (var-set vault-creation-height burn-block-height)
    (ok true)
  )
)

;; Deposit STX with chosen lock period
;; CLARITY 4: Uses burn-block-height for Bitcoin-anchored time-locking
(define-public (deposit (amount uint) (lock-tier (string-ascii 10)))
  (let
    (
      (user tx-sender)
      (lock-blocks (get-lock-blocks lock-tier))
      (yield-rate (get-yield-rate lock-tier))
      (unlock-height (+ burn-block-height lock-blocks))
    )
    ;; Validations
    (asserts! (not (var-get vault-paused)) err-vault-paused)
    (asserts! (> amount u0) err-zero-amount)
    (asserts! (<= amount max-deposit) err-invalid-amount)
    (asserts! (> lock-blocks u0) err-invalid-lock-period)
    (asserts! (not (has-active-deposit user)) err-already-exists)
    (asserts! (>= (stx-get-balance user) amount) err-insufficient-balance)
    
    ;; Transfer STX to contract
    ;; Users should set post-conditions: 
    ;; - STX transfer of exact amount
    ;; - No other assets transferred
    (try! (stx-transfer? amount user (as-contract tx-sender)))
    
    ;; Create deposit record
    (map-set deposits
      { user: user }
      {
        amount: amount,
        lock-period: lock-blocks,
        deposit-height: burn-block-height,
        unlock-height: unlock-height,
        yield-rate: yield-rate,
        withdrawn: false
      }
    )
    
    ;; Update user stats
    (update-user-stats-deposit user amount)
    
    ;; Update vault totals with overflow check
    (asserts! (<= (+ (var-get total-locked) amount) max-deposit) err-invalid-amount)
    (var-set total-locked (+ (var-get total-locked) amount))
    
    ;; Print event for indexers
    (print {
      event: "deposit",
      user: user,
      amount: amount,
      unlock-height: unlock-height,
      yield-rate: yield-rate
    })
    
    (ok {
      amount: amount,
      unlock-height: unlock-height,
      yield-rate: yield-rate
    })
  )
)

;; Withdraw principal + yield after lock period
;; CLARITY 4: Uses burn-block-height to verify lock expiration
(define-public (withdraw)
  (let
    (
      (user tx-sender)
      (deposit-info (unwrap! (map-get? deposits { user: user }) err-not-found))
      (amount (get amount deposit-info))
      (yield-earned (unwrap! (calculate-yield user) err-not-found))
      (total-payout (+ amount yield-earned))
    )
    ;; Validations
    (asserts! (not (get withdrawn deposit-info)) err-not-found)
    (asserts! (>= burn-block-height (get unlock-height deposit-info)) err-lock-period-not-met)
    (asserts! (>= (stx-get-balance (as-contract tx-sender)) total-payout) err-insufficient-vault-balance)
    
    ;; Mark as withdrawn BEFORE transfer (checks-effects-interactions pattern)
    (map-set deposits
      { user: user }
      (merge deposit-info { withdrawn: true })
    )
    
    ;; Transfer principal + yield back to user
    ;; Users should set post-conditions for expected payout
    (try! (as-contract (stx-transfer? total-payout tx-sender user)))
    
    ;; Update stats
    (update-user-stats-withdraw user amount yield-earned)
    (var-set total-locked (- (var-get total-locked) amount))
    (var-set total-yield-distributed (+ (var-get total-yield-distributed) yield-earned))
    
    ;; Print event
    (print {
      event: "withdraw",
      user: user,
      principal: amount,
      yield: yield-earned,
      total: total-payout
    })
    
    (ok {
      principal: amount,
      yield: yield-earned,
      total: total-payout
    })
  )
)