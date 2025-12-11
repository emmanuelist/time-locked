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