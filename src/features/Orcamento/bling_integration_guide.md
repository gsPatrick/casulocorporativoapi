# Guia Técnico: Integração Bling ERP (Automação B2B)

Este guia detalha o funcionamento técnico da sincronização de orçamentos entre Shopify e Bling ERP.

## Arquitetura de Sincronização

A integração ocorre de forma **assíncrona** para garantir uma experiência de usuário (UX) rápida e sem travas no frontend do Shopify.

1. **Persistência**: O orçamento é salvo localmente no PostgreSQL (`Orcamento`).
2. **Fila de Tarefas**: Uma tarefa de sincronização é enfileirada na tabela `SyncQueue`.
3. **Background Worker**: O `SyncService` processa as tarefas em segundo plano (`processQueue`).

## Gestão de Imagens e Snapshots (Angle3D)

O sistema gerencia o ciclo de vida completo dos arquivos locais:

- **Download**: Captura o snapshot do Angle3D para `/src/temp/images/`.
- **Serving**: Expõe a imagem temporariamente via rota segura: `/api/orcamento/temp-images/:token/:filename`.
- **Token de Segurança**: O `token` é único por job (`UUID/Random Hex`), garantindo que apenas o Bling acesse os arquivos durante o sync.
- **Deleção Automática**: 
  - **Cleanup de Sucesso**: O arquivo é deletado imediatamente (fs.unlink) após o `200 OK` do Bling.
  - **Cleanup de Emergência**: A cada execução, o Worker deleta arquivos com mais de 24 horas (`cleanupOldImages`).

## Regras de Negócio: Produto -> Pedido

Para garantir que o pedido seja aceito pelo Bling:
- **Identificação**: O sistema verifica se o SKU (baseado no produto + hash da configuração) existe.
- **Criação de Produto**: Se não existir, cria o produto no Bling com foto e descrição técnica.
- **Criação de Venda**: Lança o Pedido de Venda/Proposta vinculado ao produto customizado.

## Configurações Necessárias (.env)

| Variável | Descrição |
|----------|-----------|
| `BLING_ACCESS_TOKEN` | Token OAuth2 do Bling V3 |
| `BLING_REFRESH_TOKEN` | Refresh Token para renovação |
| `APP_URL` | URL base da sua API (Ex: https://api.casulo.com) |

---

**Versão**: 1.0.0
**Status**: Implementação Concluída
