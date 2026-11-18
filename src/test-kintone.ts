import "dotenv/config"

const domain = process.env.KINTONE_DOMAIN
const username = process.env.KINTONE_USERNAME
const password = process.env.KINTONE_PASSWORD

const APP_ID = 1618

if(!domain || !username ||!password){
    throw new Error(
        "缺少 KINTONE_DOMAIN、KINTONE_USERNAME或KINTONE_PASSWORD"
    )
}

const auth = Buffer.from(
    `${username}:${password}`,
    "utf-8"
).toString("base64")

const header = {
    "X-Cybozu-Authorization": auth
}

async function request(
    url: string,
    options: RequestInit = {}
): Promise<any> {
    const response = await fetch(
        url,
        {
            ...options,
            headers: {
                ...header,
                ...(options.headers ?? {})
            },
        }
    )

    const text = await response.text()

    let data: any

    try{
        data = JSON.parse(text)
    }catch{
        data = text
    }

    if (!response.ok) {
        console.error(`HTTP Status: ${response.status}`)
        console.error("kintone 回應：")
        console.error(JSON.stringify(data, null, 2))

        throw new Error(`kintone API 呼叫失敗: HTTP ${response.status}`)
    }

    return data
}

async function getRepairCases() {
    console.log("========================================")
    console.log("測試 1： 取得報修案件")
    console.log("========================================")

    const url = new URL(
        `https://${domain}/k/v1/records.json`
    )

    url.searchParams.set("app", String(APP_ID))
    url.searchParams.set("query", '状态 in ("已結案") order by $id asc limit 1')

    const data = await request(url.toString())

    console.log(`取得記錄數：${data.records.length}`)

    data.records.forEach((record: any, index: number) => {
        console.log(`\n========== 第 ${index + 1} 筆 ==========`)

        console.log(`記錄ID：${record.$id?.value ?? ""}`)
        console.log(`狀態：${record.状态?.value ?? ""}`)
        console.log(`報修單號：${record.報修單號?.value ?? ""}`)
        console.log(`客戶名稱：${record.客戶名稱?.value ?? ""}`)
        console.log(`需求簡述：${record.簡述?.value ?? ""}`)
        console.log(`案件分類：${record.案件分類?.value ?? ""}`)
        console.log(`需求內容：${record.需求內容?.value ?? ""}`)

        const assignees = record.負責SE?.value?.map((user: any) => user.name || user.code).join(", ") ?? ""

        console.log(`處理人員：${assignees}`)

        console.log(`軟硬分類：${record.軟硬分類?.value ?? ""}`)
        console.log(`需求分類2：${record.需求分類2?.value ?? ""}`)

        const category2 = record.需求分類2?.value ?? ""

        const isKintone = Array.isArray(category2)
            ? category2.some(
                (item: unknown) =>
                    String(item).trim().toLowerCase() === "kintone"
              )
            : String(category2).trim().toLowerCase() === "kintone"

        if(isKintone){
            console.log(`kintone分類：${record.APP分類?.value ?? ""}`)
        }

        console.log(`結案日期：${record.結案日期?.value ?? ""}`)
    })
}

async function getProcessManagement() {
    console.log("\n========================================")
    console.log("測試 2：取得流程管理設定")
    console.log("========================================")

    const url = new URL(
        `https://${domain}/k/v1/app/status.json`
    )

    url.searchParams.set("app",String(APP_ID))

    const data = await request(url.toString())

    console.log(`流程管理是否啟用：${data.enable}`)

    console.log("\n流程狀態：")
    console.log(JSON.stringify(data.states, null, 2))
}

async function main() {
    try{
        console.log("kintone Repair MCP API Test")
        console.log(`Domain：${domain}`)
        console.log(`App ID：${APP_ID}`)
        console.log(`登入帳號：${username}`)

        await getRepairCases()
        await getProcessManagement()

        console.log("\n========================================")
        console.log("API測試完成")
        console.log("========================================")
    }catch(error){
        console.log("\n========================================")
        console.log("API測試失敗")
        console.log("========================================")

        if(error instanceof Error){
            console.error(error.message)
        }else{
            console.error(error)
        }

        process.exit(1)
    }
}

main()