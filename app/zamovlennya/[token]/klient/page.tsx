import OrderSheet from '../page'

/**
 * Той самий бланк, але для покупця.
 *
 * Токен спільний: це те саме замовлення, і давати на нього друге
 * посилання з другим секретом означало б удвічі більше шансів його
 * загубити. Відрізняється лише те, що видно.
 */
export default async function CustomerSheet({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  return <OrderSheet params={params} forCustomer />
}
