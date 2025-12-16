# Ponto

CLI tool para registrar ponto no sistema **Facilita Ponto**.

> ⚠️ Este projeto funciona apenas para o sistema "Facilita Ponto" (sistema.facilitaponto.com.br).

## Instalação

```bash
bun add -g facilita-ponto-cli
```

## Uso

### Configurar autenticação

Primeiro, configure suas credenciais:

```bash
ponto auth
```

Você precisará informar:

- Código da empresa (emp)
- CPF

### Registrar ponto

Para registrar o ponto:

```bash
ponto
```
ou
```
bun ponto
```

## Comandos

- `ponto auth` - Configura autenticação
- `ponto` ou `ponto ponto` - Registra o ponto
- `ponto help` - Exibe ajuda

## Requisitos

- Bun runtime
- Credenciais válidas do Facilita Ponto
