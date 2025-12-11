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

    it("should allow user to deposit with medium lock period", () => {
      const depositAmount = 2000000; // 2 STX
      const { result } = simnet.callPublicFn(
        CONTRACT_NAME,
        "deposit",
        [Cl.uint(depositAmount), Cl.stringAscii("medium")],
        wallet1
      );
      
      expect(result).toBeOk(
        Cl.tuple({
          amount: Cl.uint(depositAmount),
          "unlock-height": Cl.uint(simnet.burnBlockHeight + MEDIUM_LOCK_BLOCKS),
          "yield-rate": Cl.uint(1000),
        })
      );
    });

    it("should allow user to deposit with long lock period", () => {
      const depositAmount = 5000000; // 5 STX
      const { result } = simnet.callPublicFn(
        CONTRACT_NAME,
        "deposit",
        [Cl.uint(depositAmount), Cl.stringAscii("long")],
        wallet2
      );
      
      expect(result).toBeOk(
        Cl.tuple({
          amount: Cl.uint(depositAmount),
          "unlock-height": Cl.uint(simnet.burnBlockHeight + LONG_LOCK_BLOCKS),
          "yield-rate": Cl.uint(1500),
        })
      );
    });

    it("should reject zero amount deposits", () => {
      const { result } = simnet.callPublicFn(
        CONTRACT_NAME,
        "deposit",
        [Cl.uint(0), Cl.stringAscii("short")],
        wallet1
      );
      expect(result).toBeErr(Cl.uint(108)); // err-zero-amount
    });

    it("should reject invalid lock tier", () => {
      const { result } = simnet.callPublicFn(
        CONTRACT_NAME,
        "deposit",
        [Cl.uint(1000000), Cl.stringAscii("invalid")],
        wallet1
      );
      expect(result).toBeErr(Cl.uint(107)); // err-invalid-lock-period
    });

    it("should reject duplicate deposit from same user", () => {
      const depositAmount = 1000000;
      
      // First deposit should succeed
      simnet.callPublicFn(
        CONTRACT_NAME,
        "deposit",
        [Cl.uint(depositAmount), Cl.stringAscii("short")],
        wallet1
      );
      
      // Second deposit should fail
      const { result } = simnet.callPublicFn(
        CONTRACT_NAME,
        "deposit",
        [Cl.uint(depositAmount), Cl.stringAscii("short")],
        wallet1
      );
      expect(result).toBeErr(Cl.uint(104)); // err-already-exists
    });

    it("should update vault stats after deposit", () => {
      const depositAmount = 1000000;
      
      simnet.callPublicFn(
        CONTRACT_NAME,
        "deposit",
        [Cl.uint(depositAmount), Cl.stringAscii("short")],
        wallet1
      );
      
      const { result } = simnet.callReadOnlyFn(
        CONTRACT_NAME,
        "get-vault-stats",
        [],
        wallet1
      );

      expect(result).toBeOk(
        Cl.tuple({
          "total-locked": Cl.uint(depositAmount),
          "total-yield-distributed": Cl.uint(0),
          "vault-paused": Cl.bool(false),
          "current-burn-height": Cl.uint(simnet.burnBlockHeight),
          "creation-height": Cl.uint(simnet.burnBlockHeight),
        })
      );
    });

    it("should store deposit info correctly", () => {
      const depositAmount = 1000000;
      const currentHeight = simnet.burnBlockHeight;
      
      simnet.callPublicFn(
        CONTRACT_NAME,
        "deposit",
        [Cl.uint(depositAmount), Cl.stringAscii("short")],
        wallet1
      );
      
      const { result } = simnet.callReadOnlyFn(
        CONTRACT_NAME,
        "get-deposit-info",
        [Cl.principal(wallet1)],
        wallet1
      );
      
      expect(result).toBeOk(
        Cl.some(
          Cl.tuple({
            amount: Cl.uint(depositAmount),
            "lock-period": Cl.uint(SHORT_LOCK_BLOCKS),
            "deposit-height": Cl.uint(currentHeight),
            "unlock-height": Cl.uint(currentHeight + SHORT_LOCK_BLOCKS),
            "yield-rate": Cl.uint(500),
            withdrawn: Cl.bool(false),
          })
        )
      );
    });
  });

  describe("Withdraw Function", () => {
    it("should not allow withdrawal before lock period", () => {
      const depositAmount = 1000000;
      
      // Make deposit
      simnet.callPublicFn(
        CONTRACT_NAME,
        "deposit",
        [Cl.uint(depositAmount), Cl.stringAscii("short")],
        wallet1
      );
      
      // Try to withdraw immediately
      const { result } = simnet.callPublicFn(
        CONTRACT_NAME,
        "withdraw",
        [],
        wallet1
      );
      
      expect(result).toBeErr(Cl.uint(103)); // err-lock-period-not-met
    });

    it("should allow withdrawal after lock period", () => {
      const depositAmount = 1000000;
      
      // Fund vault with yield
      simnet.callPublicFn(
        CONTRACT_NAME,
        "fund-vault",
        [Cl.uint(10000000)],
        deployer
      );
      
      // Make deposit
      simnet.callPublicFn(
        CONTRACT_NAME,
        "deposit",
        [Cl.uint(depositAmount), Cl.stringAscii("short")],
        wallet1
      );
      
      // Mine blocks to pass lock period
      simnet.mineEmptyBurnBlocks(SHORT_LOCK_BLOCKS + 1);
      
      // Withdraw
      const { result } = simnet.callPublicFn(
        CONTRACT_NAME,
        "withdraw",
        [],
        wallet1
      );

      // Calculate expected yield: (amount * yield-rate * blocks-locked) / (lock-period * 10000)
      // blocks-locked = SHORT_LOCK_BLOCKS + 1, lock-period = SHORT_LOCK_BLOCKS
      const blocksLocked = SHORT_LOCK_BLOCKS + 1;
      const expectedYield = Math.floor((depositAmount * 500 * blocksLocked) / (SHORT_LOCK_BLOCKS * 10000));
      
      expect(result).toBeOk(
        Cl.tuple({
          principal: Cl.uint(depositAmount),
          yield: Cl.uint(expectedYield),
          total: Cl.uint(depositAmount + expectedYield),
        })
      );
    });

    it("should not allow double withdrawal", () => {
      const depositAmount = 1000000;
      
      // Fund vault
      simnet.callPublicFn(
        CONTRACT_NAME,
        "fund-vault",
        [Cl.uint(10000000)],
        deployer
      );
      
      // Make deposit
      simnet.callPublicFn(
        CONTRACT_NAME,
        "deposit",
        [Cl.uint(depositAmount), Cl.stringAscii("short")],
        wallet1
      );
      
      // Mine blocks
      simnet.mineEmptyBurnBlocks(SHORT_LOCK_BLOCKS + 1);
      
      // First withdrawal
      simnet.callPublicFn(CONTRACT_NAME, "withdraw", [], wallet1);
      
      // Second withdrawal should fail
      const { result } = simnet.callPublicFn(
        CONTRACT_NAME,
        "withdraw",
        [],
        wallet1
      );
      
      expect(result).toBeErr(Cl.uint(101)); // err-not-found
    });

    it("should fail if user has no deposit", () => {
      const { result } = simnet.callPublicFn(
        CONTRACT_NAME,
        "withdraw",
        [],
        wallet1
      );
      
      expect(result).toBeErr(Cl.uint(101)); // err-not-found
    });

    it("should calculate yield correctly for medium lock", () => {
      const depositAmount = 2000000; // 2 STX
      
      // Fund vault
      simnet.callPublicFn(
        CONTRACT_NAME,
        "fund-vault",
        [Cl.uint(20000000)],
        deployer
      );
      
      // Make deposit
      simnet.callPublicFn(
        CONTRACT_NAME,
        "deposit",
        [Cl.uint(depositAmount), Cl.stringAscii("medium")],
        wallet1
      );
      
      // Mine blocks
      simnet.mineEmptyBurnBlocks(MEDIUM_LOCK_BLOCKS + 1);
      
      // Withdraw
      const { result } = simnet.callPublicFn(
        CONTRACT_NAME,
        "withdraw",
        [],
        wallet1
      );
      
      // Calculate expected yield: (amount * yield-rate * blocks-locked) / (lock-period * 10000)
      const blocksLocked = MEDIUM_LOCK_BLOCKS + 1;
      const expectedYield = Math.floor((depositAmount * 1000 * blocksLocked) / (MEDIUM_LOCK_BLOCKS * 10000));
      
      expect(result).toBeOk(
        Cl.tuple({
          principal: Cl.uint(depositAmount),
          yield: Cl.uint(expectedYield),
          total: Cl.uint(depositAmount + expectedYield),
        })
      );
    });
  });