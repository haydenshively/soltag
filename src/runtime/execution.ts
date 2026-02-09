import {
  type Abi,
  decodeFunctionResult,
  encodeFunctionData,
  getAddress,
  type Hex,
  keccak256,
  type PublicClient,
  slice,
} from "viem";

/**
 * Derive a deterministic address from a source hash.
 * Takes the first 20 bytes of the keccak256 hash.
 */
export function deriveAddress(sourceHash: Hex): Hex {
  return getAddress(slice(keccak256(sourceHash), 0, 20));
}

/**
 * Execute a read-only call against a contract deployed via stateOverride.
 */
export async function executeCall(
  client: PublicClient,
  address: Hex,
  bytecode: Hex,
  abi: Abi,
  functionName: string,
  args: readonly unknown[],
): Promise<unknown> {
  const data = encodeFunctionData({ abi, functionName, args });

  const result = await client.call({
    to: address,
    data,
    stateOverride: [
      {
        address,
        code: bytecode,
      },
    ],
  });

  if (!result.data) {
    throw new Error(`eth_call returned no data for ${functionName}`);
  }

  return decodeFunctionResult({ abi, functionName, data: result.data });
}
