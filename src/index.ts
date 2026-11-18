import "dotenv/config"

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import {  z } from "zod"
import { isTerminal } from "@modelcontextprotocol/sdk/experimental"

//環境變數
const KINTONE_DOMAIN = process.env.KINTONE_DOMAIN
const KINTONE_USERNAME = process.env.KINTONE_USERNAME
const KINTONE_PASSWORD = process.env.KINTONE_PASSWORD

const REPAIR_APP_ID = 1618

//環境變數檢查
if(!KINTONE_DOMAIN){
    throw new Error("缺少環境變數：KINTONE_DOMAIN")
}

if(!KINTONE_USERNAME){
    throw new Error("缺少環境變數：KINTONE_USERNAME")
}

if(!KINTONE_PASSWORD){
    throw new Error("缺少環境變數：KINTONE_PASSWORD")
}

//kintone認證
const authorization = Buffer.from(`${KINTONE_USERNAME}:${KINTONE_PASSWORD}`, "utf-8").toString("base64")

const commonHeaders = {"X-Cybozu-Authorization": authorization}

//工具函式
function escapeQueryString(value: string): string{
    return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')
}

function normalizeValue(value: unknown): string{
    if(value === null || value === undefined){
        return ""
    }

    if(typeof value === "string"){
        return value
    }

    if(typeof value === "number" || typeof value === "boolean"){
        return String(value)
    }

    if(Array.isArray(value)){
        return value.map((item) => {
            if(typeof item === "string"){
                return item
            }

            if(item && typeof item === "object"){
                const obj = item as Record<string, unknown>

                return String(obj.name ?? obj.code ?? obj.value ?? "")
            }

            return String(item)
        }).filter(Boolean).join(", ")
    }

    if(typeof value === "object"){
        const obj = value as Record<string, unknown>

        return String(obj.name ?? obj.code ?? obj.value ?? "")
    }

    return String(value)
}

function getFieldValue(record: Record<string, any>, fieldName: string): unknown{
    return record[fieldName]?.value
}

function getSystemFieldValue(record: Record<string, any>, fieldType: string): unknown{
    const field = Object.values(record).find(
        (item: any) => item?.type === fieldType
    )

    return (field as any)?.value
}

function formatRepairCase(record: Record<string, any>){
    const status = normalizeValue(getSystemFieldValue(record, "STATUS"))

    const repairNo = normalizeValue(getFieldValue(record, "報修單號"))

    const customer = normalizeValue(getFieldValue(record, "客戶名稱"))

    const summary = normalizeValue(getFieldValue(record, "簡述"))

    const caseCategory = normalizeValue(getFieldValue(record, "案件分類"))

    const requestContent = normalizeValue(getFieldValue(record, "需求內容"))

    const assignee = normalizeValue(getFieldValue(record, "負責SE"))

    const softwareHardware = normalizeValue(getFieldValue(record, "軟硬分類"))

    const category2Raw = getFieldValue(record, "需求分類2")

    const category2 = normalizeValue(category2Raw)

    const appCategory = normalizeValue(getFieldValue(record, "APP分類"))

    const requestTime = normalizeValue(getFieldValue(record, "報修時間"))

    const closeDate = normalizeValue(getFieldValue(record, "結案日期"))

    const isKintone = Array.isArray(category2Raw)
        ? category2Raw.some(
            (item: unknown) => 
                String(item).trim().toLowerCase() === "kintone"
          ) 
        : String(category2Raw ?? "").trim().toLowerCase() === "kintone"

    const result: Record<string, string> = {
        "記錄ID": normalizeValue(getFieldValue(record, "$id")),
        "狀態": status,
        "報修單號": repairNo,
        "客戶名稱": customer,
        "需求簡述": summary,
        "案件分類": caseCategory,
        "需求內容": requestContent,
        "處理人員": assignee,
        "軟硬分類": softwareHardware,
        "需求分類2": category2,
        "報修時間": requestTime,
        "結案日期": closeDate,
    }

    if(isKintone){
        result["kintone分類"] = appCategory
    }

    return result
}

async function kintoneRequest<T>(url: string): Promise<T>{
    const response = await fetch(url, {
        method: "GET",
        headers: commonHeaders
    })

    const responseText = await response.text()

    let data: unknown

    try {
        data = JSON.parse(responseText)
    } catch {
        data = responseText
    }

    if(!response.ok){
        console.error(`kintone API HTTP ${response.status}`)
        
        console.error(JSON.stringify(data, null, 2))

        throw new Error(`kintone API 呼叫失敗：HTTP ${response.status}`)
    }

    return data as T
}

interface SearchRepairCasesInput{
    status?: string
    repairNo?: string
    customer?: string
    assignee?: string
    dateFrom?: string
    dateTo?: string
    category?: string
    advancedQuery?: string
    limit?: number
}

function buildRepairQuery(input: SearchRepairCasesInput): string{
    const conditions: string[] = []

    if(input.status?.trim()){
        conditions.push(`状态 in ("${escapeQueryString(input.status.trim())}")`)
    }

    if(input.repairNo?.trim()){
        conditions.push(`報修單號 = "${escapeQueryString(input.repairNo.trim())}"`)
    }

    if(input.customer?.trim()){
        conditions.push(`客戶名稱 like "${escapeQueryString(input.customer.trim())}"`)
    }

    if(input.assignee?.trim()){
        conditions.push(`負責SE in ("${escapeQueryString(input.assignee.trim())}")`)
    }

    if(input.dateFrom?.trim()){
        conditions.push(`報修時間 >= "${escapeQueryString(`${input.dateFrom.trim()}T00:00:00+0800`)}"`)
    }

    if(input.dateTo?.trim()){
        conditions.push(`報修時間 <= "${escapeQueryString(`${input.dateTo.trim()}T23:59:59+0800`)}"`)
    }

    if(input.category?.trim()){
        conditions.push(`案件分類 in ("${escapeQueryString(input.category.trim())}")`)
    }

    if(input.advancedQuery?.trim()){
        conditions.push(`(${input.advancedQuery.trim()})`)
    }

    let query = ""

    if(conditions.length > 0){
        query = conditions.join(" and ")
    }

    query += "order by $id desc"

    const limit = Math.min(Math.max(input.limit ?? 20, 1), 100)

    query += ` limit ${limit}`

    return query
}

async function searchRepairCases(input: SearchRepairCasesInput) {
    const query = buildRepairQuery(input)

    const url = new URL(`https://${KINTONE_DOMAIN}/k/v1/records.json`)

    url.searchParams.set("app", String(REPAIR_APP_ID))

    url.searchParams.set("query", query)

    url.searchParams.set("totalCount", "true")

    const data = await kintoneRequest<{
        records: Record<string, any>[]
        totalCount?: string | null
    }>(url.toString())

    const cases = data.records.map(formatRepairCase)

    return{
        query,
        count: cases.length,
        totalCount: data.totalCount ?? null,
        cases
    }
}

const server = new McpServer({
    name: "kintone-repair-mcp",
    version: "1.0.0"
})

server.registerTool(
    "search_repair_cases",
    {
        description: "查詢 kintone 報修案件 App 1618。支援流程管理狀態、報修單號、客戶名稱、處理人員、報修日期區間、案件分類，以及進階 kintone Query 混合查詢。",
        inputSchema:{
        status: z.string().optional().describe("流程管理狀態，例如：未處理、處理中、內容確認中、業務對應中、文件更新中、文件寄送中、服務票待取回、服務票確認中、已結案"),
        repairNo: z.string().optional().describe("報修單號。指定後使用完全相同的報修單號查詢。"),
        customer: z.string().optional().describe("客戶名稱。可使用部分文字搜尋。"),
        assignee: z.string().optional().describe("處理人員，也就是負責SE。查詢時請使用 kintone 登入帳號。"),
        dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("報修日期起日，格式 YYYY-MM-DD。"),
        dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("報修日期迄日，格式 YYYY-MM-DD。"),
        category: z.string().optional().describe("案件分類，例如：報修。"),
        advancedQuery: z.string().optional().describe(  `進階 kintone Query，可與其他固定查詢條件搭配使用。
            注意：必須遵守 kintone 欄位類型的運算子限制。

            本 App 特殊欄位規則：
            1. 案件分類（選項按鈕）：只能使用 in、not in。
            2. 軟硬分類（選項按鈕）：只能使用 in、not in。
            3. 需求分類2（核取方塊）：只能使用 in、not in。
            4. APP分類（核取方塊）：只能使用 in、not in。
            5. 負責SE（選擇使用者）：只能使用 in、not in。

            正確範例：
            案件分類 in ("報修")
            需求分類2 in ("Kintone")
            軟硬分類 in ("軟體")

            錯誤範例：
            案件分類 = "報修"
            需求分類2 = "Kintone"

            請勿在此參數中加入 order by 或 limit，系統會自動處理。`),
        limit: z.number().int().min(1).max(100).optional().describe("最多回傳幾筆，預設 20，最多 100。")
        }
    },

    async (input) => {
        try{
            const result = await searchRepairCases(input)

            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify(
                            result, null, 2
                        )
                    }
                ]
            }
        }catch(error){
            const message = error instanceof Error ? error.message : String(error)

            console.error(`search_repair_cases 發生錯誤：${message}`)

            return{
                content: [
                    {
                        type: "text",
                        text: `查詢報修案件失敗：${message}`
                    }
                ],
                isError: true
            }
        }
    }
)

async function main() {
    console.error("kintone Repair MCP starting...")
    console.error(`Domain：${KINTONE_DOMAIN}`) 
    console.error(`App ID：${REPAIR_APP_ID}`)

    const transport = new StdioServerTransport()

    await server.connect(transport)

    console.error(`"kintone Repair MCP running on stdio"`)
}

main().catch((error) => {
    console.error("MCP Server 啟動失敗：", error)

    process.exit(1)
})