/**
 * Unit tests for cPay checksum algorithm.
 *
 * Test vectors are taken directly from the cPay Merchant Integration
 * Specification v2.6.8, Appendix A.
 *
 * Run: npx jest src/modules/cpay/__tests__/checksum.test.ts
 */

import {
  buildChecksumHeader,
  buildInputString,
  generateChecksum,
  md5Hash,
  parseChecksumHeader,
  validateReturnChecksum,
} from "../checksum"

describe("cPay Checksum — Spec Example 1 (8 params)", () => {
  const params = [
    { name: "PaymentOKURL", value: "https://bookstore/ok.html" },
    { name: "PaymentFailURL", value: "https://bookstore/fail.html" },
    { name: "AmountToPay", value: "12300" },
    { name: "AmountCurrency", value: "MKD" },
    { name: "PayToMerchant", value: "1000000003" },
    { name: "Details1", value: "purchase of books" },
    { name: "Details2", value: "Order 25467" },
    { name: "MerchantName", value: "Bookstore" },
  ]
  const checksumKey = "TEST_PASS"

  const expectedHeader =
    "08PaymentOKURL,PaymentFailURL,AmountToPay,AmountCurrency,PayToMerchant,Details1,Details2,MerchantName,025027005003010017011009"

  const expectedInputString =
    "08PaymentOKURL,PaymentFailURL,AmountToPay,AmountCurrency,PayToMerchant,Details1,Details2,MerchantName,025027005003010017011009https://bookstore/ok.htmlhttps://bookstore/fail.html12300MKD1000000003purchase of booksOrder 25467BookstoreTEST_PASS"

  const expectedChecksum = "34F2872495067872C7D11C4D0F6A3DE2"

  test("buildChecksumHeader produces correct header", () => {
    expect(buildChecksumHeader(params)).toBe(expectedHeader)
  })

  test("buildInputString produces correct input", () => {
    const header = buildChecksumHeader(params)
    expect(buildInputString(header, params, checksumKey)).toBe(expectedInputString)
  })

  test("generateChecksum produces correct MD5 hash", () => {
    const { header, checksum, inputString } = generateChecksum(params, checksumKey)
    expect(header).toBe(expectedHeader)
    expect(inputString).toBe(expectedInputString)
    expect(checksum).toBe(expectedChecksum)
  })
})

describe("cPay Checksum — Spec Example 2 (16 params)", () => {
  const params = [
    { name: "PaymentOKURL", value: "www.OKUrl.com.mk" },
    { name: "PaymentFailURL", value: "www.FailUrl.com.mk" },
    { name: "AmountToPay", value: "100" },
    { name: "AmountCurrency", value: "MKD" },
    { name: "PayToMerchant", value: "1234567890" },
    { name: "Details1", value: "Detali 1" },
    { name: "Details2", value: "123" },
    { name: "MerchantName", value: "ImeNaTrgovecot" },
    { name: "FirstName", value: "Petar" },
    { name: "LastName", value: "Petrevski" },
    { name: "Telephone", value: "021234567" },
    { name: "Email", value: "petarp@gmail.com" },
    { name: "City", value: "Skopje" },
    { name: "Country", value: "Makedonija" },
    { name: "OriginalAmount", value: "10" },
    { name: "OriginalCurrency", value: "EUR" },
  ]
  const checksumKey = "TEST_PASS"

  const expectedHeader =
    "16PaymentOKURL,PaymentFailURL,AmountToPay,AmountCurrency,PayToMerchant,Details1,Details2,MerchantName,FirstName,LastName,Telephone,Email,City,Country,OriginalAmount,OriginalCurrency,016018003003010008003014005009009016006010002003"

  const expectedChecksum = "C05F5C9C22AB31E6C782B8B0D2F6E2AE"

  test("buildChecksumHeader produces correct header", () => {
    expect(buildChecksumHeader(params)).toBe(expectedHeader)
  })

  test("generateChecksum produces correct MD5 hash", () => {
    const { header, checksum } = generateChecksum(params, checksumKey)
    expect(header).toBe(expectedHeader)
    expect(checksum).toBe(expectedChecksum)
  })
})

describe("cPay ReturnCheckSum — Spec Example (17 params, swapped first two)", () => {
  // In the return, first two params are swapped and cPayPaymentRef is added
  const returnChecksumHeader =
    "17PaymentFailURL,PaymentOKURL,AmountToPay,AmountCurrency,PayToMerchant,Details1,Details2,MerchantName,FirstName,LastName,Telephone,Email,City,Country,OriginalAmount,OriginalCurrency,cPayPaymentRef,018016003003010008003014005009009016006010002003006"

  const responseParams: Record<string, string> = {
    PaymentOKURL: "www.OKUrl.com.mk",
    PaymentFailURL: "www.FailUrl.com.mk",
    AmountToPay: "100",
    AmountCurrency: "MKD",
    PayToMerchant: "1234567890",
    Details1: "Detali 1",
    Details2: "123",
    MerchantName: "ImeNaTrgovecot",
    FirstName: "Petar",
    LastName: "Petrevski",
    Telephone: "021234567",
    Email: "petarp@gmail.com",
    City: "Skopje",
    Country: "Makedonija",
    OriginalAmount: "10",
    OriginalCurrency: "EUR",
    cPayPaymentRef: "123456",
  }

  const expectedReturnChecksum = "E3B667B51E102641D084C7BBABAEB985"
  const checksumKey = "TEST_PASS"

  test("validateReturnChecksum returns valid for correct checksum", () => {
    const result = validateReturnChecksum(
      responseParams,
      returnChecksumHeader,
      expectedReturnChecksum,
      checksumKey
    )
    expect(result.valid).toBe(true)
    expect(result.error).toBeUndefined()
  })

  test("validateReturnChecksum returns invalid for tampered amount", () => {
    const tampered = { ...responseParams, AmountToPay: "999" }
    const result = validateReturnChecksum(
      tampered,
      returnChecksumHeader,
      expectedReturnChecksum,
      checksumKey
    )
    expect(result.valid).toBe(false)
  })

  test("validateReturnChecksum returns invalid for wrong checksum", () => {
    const result = validateReturnChecksum(
      responseParams,
      returnChecksumHeader,
      "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA0",
      checksumKey
    )
    expect(result.valid).toBe(false)
  })

  test("validateReturnChecksum returns invalid for wrong key", () => {
    const result = validateReturnChecksum(
      responseParams,
      returnChecksumHeader,
      expectedReturnChecksum,
      "WRONG_KEY"
    )
    expect(result.valid).toBe(false)
  })
})

describe("parseChecksumHeader", () => {
  test("parses 8-param header correctly", () => {
    const header =
      "08PaymentOKURL,PaymentFailURL,AmountToPay,AmountCurrency,PayToMerchant,Details1,Details2,MerchantName,025027005003010017011009"
    const result = parseChecksumHeader(header)

    expect(result.paramCount).toBe(8)
    expect(result.paramNames).toEqual([
      "PaymentOKURL",
      "PaymentFailURL",
      "AmountToPay",
      "AmountCurrency",
      "PayToMerchant",
      "Details1",
      "Details2",
      "MerchantName",
    ])
    expect(result.lengths).toEqual([25, 27, 5, 3, 10, 17, 11, 9])
  })

  test("parses 17-param return header correctly", () => {
    const header =
      "17PaymentFailURL,PaymentOKURL,AmountToPay,AmountCurrency,PayToMerchant,Details1,Details2,MerchantName,FirstName,LastName,Telephone,Email,City,Country,OriginalAmount,OriginalCurrency,cPayPaymentRef,018016003003010008003014005009009016006010002003006"
    const result = parseChecksumHeader(header)

    expect(result.paramCount).toBe(17)
    // First two are swapped compared to request
    expect(result.paramNames[0]).toBe("PaymentFailURL")
    expect(result.paramNames[1]).toBe("PaymentOKURL")
    // Last param is cPayPaymentRef (added in return)
    expect(result.paramNames[16]).toBe("cPayPaymentRef")
    expect(result.lengths[16]).toBe(6) // "123456".length
  })

  test("throws on invalid header", () => {
    expect(() => parseChecksumHeader("XX")).toThrow()
  })
})

describe("md5Hash", () => {
  test("produces uppercase 32-char hex", () => {
    const hash = md5Hash("test")
    expect(hash).toHaveLength(32)
    expect(hash).toMatch(/^[0-9A-F]{32}$/)
  })
})
