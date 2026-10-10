'use strict'

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  /* Produtos */
  listarProdutos:   ()          => ipcRenderer.invoke('produtos:listar'),
  criarProduto:     (d)         => ipcRenderer.invoke('produtos:criar', d),
  atualizarProduto: (id, d)     => ipcRenderer.invoke('produtos:atualizar', id, d),
  deletarProduto:   (id)        => ipcRenderer.invoke('produtos:deletar', id),
  buscarPorCodigo:  (c)         => ipcRenderer.invoke('produtos:buscarPorCodigo', c),
  definirPromocao:  (id, p)     => ipcRenderer.invoke('produtos:promocao', id, p),

  /* Admin */
  adminLogin:            (email, senha) => ipcRenderer.invoke('admin:login', email, senha),
  adminLogout:           ()             => ipcRenderer.invoke('admin:logout'),
  adminAlterarSenha:     (atual, nova)  => ipcRenderer.invoke('admin:alterarSenha', atual, nova),
  adminAtualizarCusto:   (id, v)        => ipcRenderer.invoke('admin:atualizarCusto', id, v),
  adminAtualizarEstoque: (id, v)        => ipcRenderer.invoke('admin:atualizarEstoque', id, v),
  adminLucro:            (m, a)         => ipcRenderer.invoke('admin:lucro', m, a),
  adminEstornar:         (id)           => ipcRenderer.invoke('admin:estornar', id),
  adminBackup:           ()             => ipcRenderer.invoke('admin:backup'),
  adminListarBackups:    ()             => ipcRenderer.invoke('admin:listarBackups'),
  adminAbrirPastaBackups:()             => ipcRenderer.invoke('admin:abrirPastaBackups'),

  /* Vendas */
  finalizarVenda:     (d)    => ipcRenderer.invoke('vendas:finalizar', d),
  proximoNumeroVenda: ()     => ipcRenderer.invoke('vendas:proximoNumero'),
  vendasHoje:         ()     => ipcRenderer.invoke('vendas:hoje'),
  vendasMensais:      (m, a) => ipcRenderer.invoke('vendas:mensais', m, a),
  maisVendidos:       (m, a) => ipcRenderer.invoke('vendas:maisVendidos', m, a),
  detalhesVenda:      (id)   => ipcRenderer.invoke('vendas:detalhes', id),

  /* Caixa */
  caixaAtual:      ()               => ipcRenderer.invoke('caixa:atual'),
  abrirCaixa:      (v)              => ipcRenderer.invoke('caixa:abrir', v),
  movimentarCaixa: (tipo, v, motivo)=> ipcRenderer.invoke('caixa:movimentar', tipo, v, motivo),
  fecharCaixa:     (v, obs)         => ipcRenderer.invoke('caixa:fechar', v, obs),
  resumoCaixa:     (id)             => ipcRenderer.invoke('caixa:resumo', id),
  listarCaixas:    (m, a)           => ipcRenderer.invoke('caixa:listar', m, a),

  /* Clientes e fiado */
  listarClientes:   ()   => ipcRenderer.invoke('clientes:listar'),
  salvarCliente:    (d)  => ipcRenderer.invoke('clientes:salvar', d),
  excluirCliente:   (id) => ipcRenderer.invoke('clientes:excluir', id),
  extratoCliente:   (id) => ipcRenderer.invoke('clientes:extrato', id),
  receberCliente:   (d)  => ipcRenderer.invoke('clientes:receber', d),

  /* Trocas e vales */
  itensParaTroca: (id)   => ipcRenderer.invoke('trocas:itensVenda', id),
  registrarTroca: (d)    => ipcRenderer.invoke('trocas:registrar', d),
  listarTrocas:   (m, a) => ipcRenderer.invoke('trocas:listar', m, a),
  detalhesTroca:  (id)   => ipcRenderer.invoke('trocas:detalhes', id),
  buscarVale:     (c)    => ipcRenderer.invoke('vales:buscar', c),
  listarVales:    ()     => ipcRenderer.invoke('vales:listar'),

  /* Fornecedores e entradas (admin) */
  listarFornecedores: ()     => ipcRenderer.invoke('fornecedores:listar'),
  salvarFornecedor:   (d)    => ipcRenderer.invoke('fornecedores:salvar', d),
  excluirFornecedor:  (id)   => ipcRenderer.invoke('fornecedores:excluir', id),
  registrarEntrada:   (d)    => ipcRenderer.invoke('entradas:registrar', d),
  listarEntradas:     (m, a) => ipcRenderer.invoke('entradas:listar', m, a),
  detalhesEntrada:    (id)   => ipcRenderer.invoke('entradas:detalhes', id)
})
