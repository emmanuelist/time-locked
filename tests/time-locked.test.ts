import { describe, expect, it, beforeEach } from "vitest";
import { Cl } from "@stacks/transactions";

const accounts = simnet.getAccounts();
const deployer = accounts.get("deployer")!;
const wallet1 = accounts.get("wallet_1")!;
const wallet2 = accounts.get("wallet_2")!;

const CONTRACT_NAME = "time-locked";

// Error codes
const ERR_OWNER_ONLY = Cl.error(Cl.uint(100));
const ERR_NOT_FOUND = Cl.error(Cl.uint(101));
const ERR_INSUFFICIENT_BALANCE = Cl.error(Cl.uint(102));
const ERR_LOCK_PERIOD_NOT_MET = Cl.error(Cl.uint(103));
const ERR_ALREADY_EXISTS = Cl.error(Cl.uint(104));
const ERR_INVALID_AMOUNT = Cl.error(Cl.uint(105));
const ERR_VAULT_PAUSED = Cl.error(Cl.uint(106));
const ERR_INVALID_LOCK_PERIOD = Cl.error(Cl.uint(107));
const ERR_ZERO_AMOUNT = Cl.error(Cl.uint(108));

// Lock period constants
const SHORT_LOCK_BLOCKS = 4320;  // ~30 days
const MEDIUM_LOCK_BLOCKS = 8640; // ~60 days
const LONG_LOCK_BLOCKS = 17280;  // ~120 days

describe("Time-Locked Vault Contract", () => {
  
  describe("Initialization", () => {
    it("should initialize vault on deployment", () => {
      const { result } = simnet.callReadOnlyFn(
        CONTRACT_NAME,
        "get-vault-stats",
        [],
        deployer
      );
      expect(result).toBeOk(
        Cl.tuple({
          "total-locked": Cl.uint(0),
          "total-yield-distributed": Cl.uint(0),
          "vault-paused": Cl.bool(false),
          "current-burn-height": Cl.uint(simnet.burnBlockHeight),
          "creation-height": Cl.uint(simnet.burnBlockHeight),
        })
      );
    });

    it("should prevent double initialization of vault", () => {
      const { result } = simnet.callPublicFn(
        CONTRACT_NAME,
        "initialize-vault",
        [],
        deployer
      );
      expect(result).toBeErr(Cl.uint(104)); // err-already-exists
    });

    it("should not allow non-owner to initialize vault", () => {
      const { result } = simnet.callPublicFn(
        CONTRACT_NAME,
        "initialize-vault",
        [],
        wallet1
      );
      expect(result).toBeErr(Cl.uint(100)); // err-owner-only
    });
  });

  describe("Deposit Function", () => {
    it("should allow user to deposit with short lock period", () => {
      const depositAmount = 1000000; // 1 STX
      const { result } = simnet.callPublicFn(
        CONTRACT_NAME,
        "deposit",
        [Cl.uint(depositAmount), Cl.stringAscii("short")],
        wallet1
      );
      
      expect(result).toBeOk(
        Cl.tuple({
          amount: Cl.uint(depositAmount),
          "unlock-height": Cl.uint(simnet.burnBlockHeight + SHORT_LOCK_BLOCKS),
          "yield-rate": Cl.uint(500),
        })
      );
    });