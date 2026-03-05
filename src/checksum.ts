/**
 * cPay CheckSum Specification Implementation
 *
 * Implements the MD5 checksum algorithm as defined in cPay Merchant Integration
 * Specification v2.6.8, Appendix A.
 *
 * The checksum protects payment integrity:
 * - Request CheckSum: merchant -> cPay (proves request authenticity)
 * - ReturnCheckSum: cPay -> merchant (proves response authenticity)
 *
 * Algorithm:
 *   InputString = Header + Value1 + Value2 + ... + ValueN + ChecksumAuthKey
 *   CheckSum    = MD5(UTF-8(InputString))  // 32-char uppercase hex
 *
 * Header format:
 *   NN + ParamName1,ParamName2,...ParamNameN, + LLL1 + LLL2 + ... + LLLN
 *   where NN = param count (2 digits), LLL = value length (3 digits each)
 */

import { createHash } from "crypto"

export interface ChecksumParam {
  name: string
  value: string
}

/**
 * Build the checksum header string per cPay specification.
 *
 * Format: NNParamName1,ParamName2,...ParamNameN,LLL1LLL2...LLLN
 *
 * Important: character length (not byte length) is used for LLL fields.
 * The spec states: "the length of each character should be count 1"
 * meaning we count Unicode code points, not UTF-16 code units.
 */
export function buildChecksumHeader(params: ChecksumParam[]): string {
  const nn = String(params.length).padStart(2, "0")

  const names = params.map((p) => p.name).join(",") + ","

  const lengths = params
    .map((p) => {
      // Use Array.from to correctly count Unicode code points
      const charLength = Array.from(p.value).length
      return String(charLength).padStart(3, "0")
    })
    .join("")

  return nn + names + lengths
}

/**
 * Build the full input string for MD5 hashing.
 *
 * InputString = Header + Value1 + Value2 + ... + ValueN + checksumKey
 *
 * Note: the checksumKey is NEVER included in the header param count (NN)
 * or in any CheckSumHeader/ReturnCheckSumHeader fields.
 */
export function buildInputString(
  header: string,
  params: ChecksumParam[],
  checksumKey: string
): string {
  const values = params.map((p) => p.value).join("")
  return header + values + checksumKey
}

/**
 * Compute MD5 hash of a UTF-8 encoded string.
 * Returns uppercase 32-character hex string.
 */
export function md5Hash(input: string): string {
  return createHash("md5").update(input, "utf8").digest("hex").toUpperCase()
}

/**
 * Generate the CheckSum and CheckSumHeader for a cPay payment request.
 *
 * @param params - Ordered array of {name, value} pairs (only non-empty values)
 * @param checksumKey - The merchant's checksum authentication key
 * @returns header (CheckSumHeader), checksum (CheckSum), and inputString for debugging
 *
 * @example
 * ```ts
 * const { header, checksum } = generateChecksum([
 *   { name: "PaymentOKURL", value: "https://bookstore/ok.html" },
 *   { name: "PaymentFailURL", value: "https://bookstore/fail.html" },
 *   { name: "AmountToPay", value: "12300" },
 *   { name: "AmountCurrency", value: "MKD" },
 *   { name: "PayToMerchant", value: "1000000003" },
 *   { name: "Details1", value: "purchase of books" },
 *   { name: "Details2", value: "Order 25467" },
 *   { name: "MerchantName", value: "Bookstore" },
 * ], "TEST_PASS")
 * // checksum === "34F2872495067872C7D11C4D0F6A3DE2"
 * ```
 */
export function generateChecksum(
  params: ChecksumParam[],
  checksumKey: string
): { header: string; checksum: string; inputString: string } {
  const header = buildChecksumHeader(params)
  const inputString = buildInputString(header, params, checksumKey)
  const checksum = md5Hash(inputString)

  return { header, checksum, inputString }
}

/**
 * Parse a cPay checksum header to extract parameter names and value lengths.
 *
 * Header format: NNParamName1,ParamName2,...ParamNameN,LLL1LLL2...LLLN
 *
 * @param header - The CheckSumHeader or ReturnCheckSumHeader string
 */
export function parseChecksumHeader(header: string): {
  paramCount: number
  paramNames: string[]
  lengths: number[]
} {
  const paramCount = parseInt(header.substring(0, 2), 10)

  if (isNaN(paramCount) || paramCount < 1) {
    throw new Error(`Invalid checksum header: cannot parse param count from "${header.substring(0, 2)}"`)
  }

  const rest = header.substring(2)

  // The last (paramCount * 3) chars are the length fields (LLL per param)
  const lengthsStr = rest.substring(rest.length - paramCount * 3)
  const namesStr = rest.substring(0, rest.length - paramCount * 3)

  // Parse comma-separated param names (trailing comma present)
  const paramNames = namesStr.split(",").filter((n) => n.length > 0)

  if (paramNames.length !== paramCount) {
    throw new Error(
      `Header declares ${paramCount} params but found ${paramNames.length} names`
    )
  }

  // Parse 3-digit length fields
  const lengths: number[] = []
  for (let i = 0; i < paramCount; i++) {
    lengths.push(parseInt(lengthsStr.substring(i * 3, i * 3 + 3), 10))
  }

  return { paramCount, paramNames, lengths }
}

/**
 * Validate a ReturnCheckSum received from cPay.
 *
 * This MUST be called on every cPay response (both PUSH notifications
 * and browser redirects) to prevent fraud.
 *
 * The ReturnCheckSum differs from the request CheckSum:
 * - The first two parameters in the header are swapped
 *   (PaymentFailURL, PaymentOKURL instead of PaymentOKURL, PaymentFailURL)
 * - cPayPaymentRef is added (if card data was submitted)
 *
 * @param responseParams - All parameters from the cPay response (key-value)
 * @param returnChecksumHeader - The ReturnCheckSumHeader from cPay
 * @param returnChecksum - The ReturnCheckSum from cPay
 * @param checksumKey - The merchant's checksum authentication key
 * @returns Validation result with error details if invalid
 */
export function validateReturnChecksum(
  responseParams: Record<string, string>,
  returnChecksumHeader: string,
  returnChecksum: string,
  checksumKey: string
): { valid: boolean; error?: string } {
  try {
    const { paramNames, lengths } = parseChecksumHeader(returnChecksumHeader)

    // Verify value lengths match header declaration (integrity check)
    for (let i = 0; i < paramNames.length; i++) {
      const value = responseParams[paramNames[i]] ?? ""
      const actualLength = Array.from(value).length
      if (actualLength !== lengths[i]) {
        return {
          valid: false,
          error: `Length mismatch for ${paramNames[i]}: header declares ${lengths[i]}, actual is ${actualLength}`,
        }
      }
    }

    // Build input string using cPay's header (not a rebuilt one)
    // InputString = ReturnCheckSumHeader + Values(in header order) + ChecksumKey
    let inputString = returnChecksumHeader
    for (const name of paramNames) {
      inputString += responseParams[name] ?? ""
    }
    inputString += checksumKey

    const computed = md5Hash(inputString)

    if (computed !== returnChecksum.toUpperCase()) {
      return {
        valid: false,
        error: `Checksum mismatch: computed ${computed}, received ${returnChecksum.toUpperCase()}`,
      }
    }

    return { valid: true }
  } catch (err) {
    return {
      valid: false,
      error: `Checksum validation error: ${err instanceof Error ? err.message : String(err)}`,
    }
  }
}
