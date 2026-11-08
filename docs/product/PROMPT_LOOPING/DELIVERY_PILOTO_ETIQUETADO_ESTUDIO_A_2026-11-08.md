# Piloto de etiquetado masivo · Estudio real A (cerveza, Brasil)

Fecha de corte: 2026-11-08. Mapa congelado antes de comparar con el estudio entregado.

Raíces: 83962. Grupos BERTopic totales (incluye Noise y grupos no adoptados): 144. Tópicos finales: 98.
Universo de menciones: 96,150 únicas, 12,188 excluidas y 83,962 elegibles.

## Costos y tiempos

| Etapa | Población de entrada | Valor tarifario del uso | Cargo confirmado | Claude por grupo | Tokens gratis | Tiempo de reloj |
|---|---:|---:|---:|---:|---:|---:|
| voyage | 127122 fragments | USD 3.071635 | USD 0.000000 | — | 25592964 | 857.7 s |
| bertopic | 83962 roots | USD 0.000000 | USD 0.000000 | — | 0 | 923.8 s |
| claude | 144 groups | USD 8.029482 | USD 8.030000 | USD 0.055764 | 0 | 41727.9 s |
| jev_smoke | 1000 roots | USD 0.104857 | n/d | — | 0 | 210.2 s |
| jev_full | 82962 roots | USD 8.716239 | n/d | — | 0 | 6245.9 s |

Uso a tarifa del piloto: Voyage USD 3.071156, JEV USD 8.778833, Claude USD 8.029482. Total USD 19.879471. Voyage se cubrió con tokens gratis y su cargo confirmado fue USD 0.000000.
Claude confirmado por 144 grupos editoriales: USD 8.030000. Cargo JEV por etapa: no atribuible con las lecturas de saldo disponibles. Los costes a tarifa son estimaciones de uso, no débitos.
Tokens gratis consumidos: 25592964.
Voyage usó 25,592,964 tokens gratis; su cargo efectivo confirmado fue USD 0.000000.
Techo acumulado JEV: USD 9.500000 (incluye humo y corte completo; no es un cargo).
Disminución del saldo entre lecturas de JEV: USD 0.110000 sin atribución a una etapa.
La observación de JEV no permite atribuir todo el cambio entre saldos; se omite del cargo de etapas.
Proyección lineal por millón de raíces con la misma longitud media de menciones y cantidad media de fragmentos. Voyage y JEV escalan por raíz; Claude escala por grupo editorial.

| Grupos editoriales supuestos | Voyage a tarifa | JEV por raíz | Claude por grupo | Total a tarifa |
|---:|---:|---:|---:|---:|
| 180 | USD 36.577924 | USD 104.557215 | USD 10.036853 | USD 151.171991 |
| 225 | USD 36.577924 | USD 104.557215 | USD 12.546066 | USD 153.681205 |
| 270 | USD 36.577924 | USD 104.557215 | USD 15.055279 | USD 156.190418 |

## Cobertura

Tópico > 0.7: 67.6%. Franja intermedia ([0.3, 0.7], sin tópico positivo): 20.7%. Sin tópico (< 0.3): 11.7%. Sin resultado válido: 0.0%.
Promoción > 0.7: 26.5% de respuestas válidas. Spam o bot > 0.7: 1.4% de respuestas válidas.
Relevancia genérica histórica (no mide voz del consumidor): 731 positivas, 11803 intermedias y 71428 negativas.
Motivadores y barreras históricos por promoción >0.7 (pregunta anterior, sin filtro de voz): trigger 21201 promoción / 13202 sin promoción; barrier 28 promoción / 4265 sin promoción.
Triggers: 34403 (41.0%). Barriers: 4293 (5.1%). None: 26160 (31.2%). Intermedio: 19106 (22.8%). Sin resolver: 0.

## Mapa de tópicos

<details><summary>98 tópicos, 144 grupos BERTopic</summary>

| Tópico | Definición | Raíces con probabilidad > 0.7 |
|---|---|---:|
| Debates sobre clubes e desempenho esportivo | Comentários sobre jogadores, decisões táticas, contratações, resultados e gestão de clubes. | 7529 |
| Interações informais sobre futebol | Respostas curtas com opiniões, provocações, humor e reações a conteúdos de futebol. | 6442 |
| Celebrações e encontros sociais | Registros de festas e confraternizações entre amigos, colegas e comunidades, muitas vezes com comida e bebidas. | 6401 |
| Desejo de encontros e celebrações | Conversas sobre planejar ou aproveitar encontros com amigos e família, comida, música e lazer. | 6300 |
| Cardápios e experiência em bares | Promoção de cardápios, petiscos, pizzas e bebidas em bares, com convites para encontros e música ao vivo. | 6252 |
| Cultura do churrasco e preparo na brasa | Conversas sobre cortes, técnicas de preparo, restaurantes e sociabilidade em torno da churrasqueira. | 5623 |
| Humor e reações informais | Comentários de humor, risadas e brincadeiras em conversas de redes sociais. | 5602 |
| Gastronomia, bares e eventos de lazer | Cobertura de restaurantes, festivais, cardápios, bebidas, música e atividades de lazer. | 5472 |
| Felicitações e interações sociais | Mensagens curtas de agradecimento, felicitação, torcida e reação afetiva a conteúdos de terceiros. | 4088 |
| Reações de torcedores a lances | Comentários emocionais e técnicos sobre gols, pênaltis, goleiros e atuações em partidas. | 3218 |
| Promoções e happy hour em bares | Ofertas de bebidas, combos e happy hour em bares e restaurantes. | 3009 |
| Música ao vivo em bares | Anúncios de shows e programação musical em bares, pubs e casas de entretenimento. | 2856 |
| Promoção de churrascarias e restaurantes | Divulgação de rodízios, cortes, buffet, delivery e serviços de restaurantes especializados em churrasco. | 2367 |
| Preferências por cervejas populares | Comentários informais sobre preferências, comparações e ocasiões de consumo de cervejas. | 2086 |
| Recomendações de bares e botecos | Opiniões sobre estabelecimentos, petiscos, bebidas, preços e ambiente de bares. | 2025 |
| Experiência de torcedores nos estádios | Conversas sobre ingressos, bebidas, segurança, infraestrutura e comportamento de torcidas em estádios. | 1738 |
| Agenda de eventos culturais | Programação de festivais, shows, feiras e atividades de lazer, com informações de datas, atrações e acesso. | 1717 |
| Debate político nacional | Opiniões sobre governo, oposição, instituições, economia e democracia. | 1510 |
| Bares com transmissão esportiva e promoções | Convites de bares e restaurantes para acompanhar partidas ao vivo, com ofertas de bebidas e consumo no local. | 1414 |
| Leilões de cutelaria artesanal com lance inicial | Anúncios de leilões de facas artesanais e acessórios, com regras, dimensões e lance inicial. | 1287 |
| Bares e pizzarias com jogos ao vivo | Convites para assistir a partidas em restaurantes, com comidas, bebidas e promoções. | 1286 |
| Segurança pública e sistema judiciário | Conversas sobre crime, segurança, corrupção, punições e instituições judiciais. | 1217 |
| Engajamento de espectadores com criadores | Comentários de audiência que elogiam vídeos, pedem novos conteúdos e interagem com canais. | 1072 |
| Ofertas de supermercados | Anúncios de descontos em mercearia, bebidas, carnes e itens domésticos. | 1064 |
| Comentários de torcedores sobre um clube | Reações, rivalidades e humor de torcedores sobre resultados e partidas de um clube. | 989 |
| Comida e bebidas ao acompanhar a seleção | Publicações que associam refeições e bebidas a encontros para assistir a partidas da seleção nacional. | 925 |
| Entrega de bebidas geladas | Anúncios de distribuidoras e lojas locais com entrega de cervejas e outras bebidas refrigeradas. | 921 |
| Interações em receitas culinárias | Comentários de elogio, interesse em preparar receitas e pedidos de novas sugestões culinárias. | 910 |
| Arbitragem e VAR no futebol | Debates sobre gols anulados, pênaltis, decisões de árbitros e uso de tecnologia em partidas. | 770 |
| Memes sobre consumo casual de bebidas | Publicações humorísticas que usam referências a uma bebida casual como justificativa para situações inesperadas. | 768 |
| Jogos e rivalidades de uma torcida | Previsões, resultados, desempenho e provocações sobre partidas de um clube. | 746 |
| Promoções de hamburguerias artesanais | Anúncios de cardápios, lanches, acompanhamentos, visitas e entrega em hamburguerias. | 744 |
| Patrocínios e publicidade no futebol | Conversas sobre patrocínios, promoções e publicidade de bebidas em torneios e partidas de futebol. | 738 |
| Crítica política por meio do entretenimento | Opiniões sobre participação cívica e política que usam futebol, festas e lazer como referências. | 722 |
| Uso coloquial de resenha e interação social | Conversas informais em que uma gíria descreve brincadeiras, encontros e momentos descontraídos. | 656 |
| Consumo, churrasco e classe social | Debates sobre consumo de bebidas e churrasco como sinais de hábitos, prioridades financeiras e posição social. | 653 |
| Avaliações de automóveis | Opiniões de consumidores sobre modelos de veículos, preço, qualidade, conforto, segurança e custo-benefício. | 650 |
| Promessas políticas e custo de vida | Debates sobre promessas eleitorais de consumo e percepções sobre preços e poder de compra. | 560 |
| Consumo de refrigerantes e campanhas | Publicações sobre consumo cotidiano de refrigerantes, campanhas publicitárias e parcerias comerciais. | 542 |
| Reações de fãs a músicas e artistas | Mensagens de admiração e entusiasmo por canções, artistas e apresentações musicais. | 541 |
| Humor e estilo de vida em redes sociais | Posts curtos de entretenimento, humor e reflexão pessoal publicados por perfis locais. | 521 |
| Reações à seleção nacional de futebol | Comentários de torcedores sobre resultados, desempenho e participação da seleção em competições. | 516 |
| Ofertas de packs de cerveja | Promoções de embalagens de cerveja em lojas e plataformas digitais, com preços e descontos. | 514 |
| Ingressos e promoções no pré-jogo | Informações sobre ingressos, atividades antes das partidas e ofertas nos arredores de estádios. | 480 |
| Preço de cervejas em bares e eventos | Conversas que comparam preços de bebidas em bares, praias, eventos e espaços de lazer. | 476 |
| Títulos e tradição no futebol | Debates de torcedores sobre conquistas, tradição e relevância histórica de clubes em competições. | 440 |
| Refrigerantes em comércios locais | Anúncios de refrigerantes gelados e bebidas não alcoólicas em lojas e distribuidoras locais. | 428 |
| Cobertura esportiva e gestão de clube | Notícias e análises sobre resultados, jogadores, finanças, competições e administração de um clube. | 427 |
| Reações a frases virais de política | Conversas que citam ou satirizam frases políticas associadas a crime, consumo e lazer. | 407 |
| Portfólios de cervejarias artesanais | Apresentação de rótulos, estilos, história, prêmios e atividades de cervejarias de diferentes portes. | 393 |
| Leilões de cutelaria artesanal com lance livre | Anúncios de leilões de facas e acessórios artesanais sem preço inicial definido. | 379 |
| Restaurantes com buffet variado | Promoções de restaurantes com diferentes opções de refeições, bebidas e serviços. | 345 |
| Sátira política e diplomacia de bar | Comentários irônicos que associam conversas informais em bares a temas de política externa. | 342 |
| Celebrações políticas com comida e bebida | Publicações humorísticas ou opinativas que associam acontecimentos políticos a celebrações informais. | 340 |
| Campanhas de apoio a clubes por compras | Conversas sobre iniciativas que direcionam parte de compras de bebidas a clubes escolhidos por consumidores. | 335 |
| Rivalidade entre torcidas nacionais | Provocações, estereótipos e debates sobre rivalidade esportiva e identidade entre torcidas de países. | 331 |
| Rodízios e bebidas em restaurantes | Anúncios de rodízios, preços, horários e bebidas disponíveis em restaurantes. | 324 |
| Discussões sobre reality shows | Opiniões sobre participantes, alianças, votações e estratégias em programas de competição televisiva. | 321 |
| Conversas sobre frio e temperatura | Relatos e comentários sobre clima frio, temperaturas baixas e sensações relacionadas ao inverno. | 307 |
| Patrocínios de bebidas no esporte | Conversas sobre patrocínios, lançamentos, portfólios e parcerias esportivas de marcas de bebidas. | 298 |
| Preferências e receitas com beterraba | Comentários sobre gosto, preparo e interesse em receitas com beterraba. | 261 |
| Discussões sobre jogos eletrônicos | Resenhas e conversas sobre títulos, lançamentos, desenvolvedoras, desempenho e mercado de games. | 256 |
| Receitas de sobremesas e doces | Receitas de bolos, pudins, tortas e doces, incluindo variações para diferentes preferências alimentares. | 226 |
| Promoção de comida e churrasco local | Publicações de estabelecimentos locais sobre lanches, espetinhos, bebidas e entrega. | 192 |
| Consumo social e equilíbrio alimentar | Dicas sobre como conciliar alimentação, atividade social e consumo moderado em fins de semana e celebrações. | 185 |
| Hardware e jogos digitais | Discussões sobre equipamentos de computador e console, jogos, emulação e transmissões ao vivo. | 172 |
| Demandas políticas por segurança pública | Posts que defendem modelos de política de segurança e combate ao crime. | 170 |
| Preços de combustíveis | Discussões sobre gasolina, diesel, etanol, impostos e impacto dos preços para consumidores. | 170 |
| Reações sobre cães de grande porte | Comentários de admiração, relatos e interesse em cães de grande porte e guarda. | 163 |
| Conquistas e decoração do lar | Comentários de admiração, apoio e alegria diante de conquistas de moradia, decoração e conforto doméstico. | 156 |
| Ofertas de eletrodomésticos | Anúncios de refrigeradores e eletrodomésticos com preços, cupons e links de compra. | 153 |
| Programação de pubs locais | Anúncios de programação semanal em pubs e espaços noturnos, incluindo música ao vivo, promoções e informações de visita. | 147 |
| Provocações irônicas entre torcedores | Comentários de escárnio e provocações dirigidas a rivais e participantes de debates. | 143 |
| Cardápio e promoções de churrascaria | Publicações sobre cardápios, cortes, bebidas e serviços de uma churrascaria local. | 142 |
| Acessórios para bebidas e churrasco | Publicações sobre acessórios artesanais e personalizados para servir bebidas e apoiar encontros ao redor da churrasqueira. | 139 |
| Caixas térmicas para lazer | Ofertas de coolers e acessórios de refrigeração voltados a churrascos, praia, camping e atividades ao ar livre. | 138 |
| Aluguel e entrega de chope para eventos | Ofertas de barris e equipamentos para servir chope em festas, churrascos e celebrações. | 138 |
| Divisão de custos em churrascos | Debates sobre como dividir despesas e contribuições entre convidados em festas e churrascos. | 136 |
| Degustações de cervejas lager | Resenhas sobre aroma, sabor, corpo, aparência, origem e harmonização de cervejas lager. | 131 |
| Checagem de conteúdo político editado | Publicações que analisam vídeos editados, contexto de falas e correções de informação política. | 129 |
| Eventos de samba e pagode | Divulgação de apresentações de samba e pagode, com detalhes de atrações, horários e ambiente. | 128 |
| Debate sobre atleta e clube | Opiniões sobre desempenho, comportamento e impacto de um atleta em seu clube. | 128 |
| Produtos personalizados de clubes | Venda e lançamento de artigos, acessórios e uniformes associados a clubes esportivos. | 127 |
| Divulgação de casa noturna local | Posts de convite e divulgação de eventos noturnos de um estabelecimento de entretenimento. | 109 |
| Torcidas organizadas e governança de clubes | Conversas sobre punições, protestos, organização de torcidas e administração de clubes. | 109 |
| Ingressos e informações de estádio | Publicações sobre venda de ingressos, setores, partidas e infraestrutura de um estádio. | 99 |
| Sorteios com kits para churrasco | Promoções e sorteios de bebidas e acessórios para churrasco com mecânicas de engajamento. | 98 |
| Varejo local de bebidas | Publicações de comércio local sobre bebidas geladas, destilados e opções para consumo. | 87 |
| Debate sobre conflitos geopolíticos | Discussões em língua portuguesa sobre conflitos internacionais, atores políticos e cobertura na mídia. | 82 |
| Marketing emocional de bebidas no futebol | Campanhas, parcerias e promoções de bebidas associadas a torneios de futebol. | 82 |
| Opiniões sobre a gestão estadual | Comentários sobre políticas públicas, serviços e desempenho de um governo estadual. | 80 |
| Metáforas sobre queda de rendimento esportivo | Expressões irônicas que comparam o desempenho de equipes e atletas à perda gradual de energia. | 75 |
| Manejo comportamental de cães | Dicas de contenção, segurança, enriquecimento ambiental e treinamento de cães. | 72 |
| Memórias de campanhas promocionais esportivas | Relatos sobre brindes e embalagens promocionais distribuídos em edições anteriores de grandes torneios. | 70 |
| Ativações esportivas de marcas de bebidas | Campanhas e experiências promocionais de bebidas associadas a campeonatos e eventos esportivos. | 54 |
| Debates sobre lances e disciplina esportiva | Discussões sobre intencionalidade, fair play, punições e interpretação de lances em partidas. | 46 |
| Reações de fãs à aparência de criador | Comentários de seguidores sobre mudanças na aparência de uma personalidade de conteúdo. | 45 |
| Crédito em bancos digitais | Discussões sobre limites de crédito, renegociação, cartões e reconstrução de histórico financeiro. | 44 |

</details>

## Correcciones R13

La relevancia genérica histórica se conserva como diagnóstico. Dio 731 positivas, 11803 intermedias y 71428 negativas.
El desglose histórico de motivadores y barreras, sin filtrar voz, separa promoción >0.7 y sin promoción: triggers 21201 / 13202; barriers 28 / 4265.
La pregunta corregida nombró cerveza y el indicador usa voz individual o conversación, promoción ≤0.7 y texto del post que no sea sólo hashtags. Elegibles: 50273; triggers 4711, barriers 1163, none 36061, intermedios 8338, sin resolver 0. Desglose elegible: individual {"trigger":4711,"barrier":1163,"none":36061,"intermediate":8338,"unresolved":0}; conversación {"trigger":0,"barrier":0,"none":0,"intermediate":0,"unresolved":0}. Etiquetado en todo el corpus, incluido el diagnóstico no elegible: 4921 triggers, 1215 barriers, 68031 none, 9795 intermedios y 0 sin resolver.
La comparación inicial verificó la presencia de las dimensiones trigger/barrier. No estableció la coincidencia de causas concretas.

### Proyección corregida por millón de raíces

| Grupos editoriales | Voyage a tarifa | JEV por raíz | Claude por grupo | Total a tarifa |
|---:|---:|---:|---:|---:|
| 180 | USD 36.577924 | USD 104.557215 | USD 10.036853 | USD 151.171991 |
| 225 | USD 36.577924 | USD 104.557215 | USD 12.546066 | USD 153.681205 |
| 270 | USD 36.577924 | USD 104.557215 | USD 15.055279 | USD 156.190418 |

El uso histórico de Voyage costó USD 3.071156 a tarifa y su cargo confirmado fue USD 0. El uso tarifario de JEV es USD 8.778833. Claude costó USD 8.029482 para 144 grupos, USD 0.055760 por grupo. Total piloto a tarifa USD 19.879471.
Cargo confirmado por etapa: Voyage USD 0.000000, Claude USD 8.030000, JEV no atribuible por etapa con la evidencia disponible.

### Intereses definidos
Apostas cubrió 562 raíces (0.67%); Racismo cubrió 304 (0.36%). La unión cubrió 866 raíces y la intersección 0.

### Comparación de costo por número de preguntas
En 1000 raíces elegidas de forma pareada, el promedio fue 2489.14 tokens por raíz con trece preguntas y 1411.38 con siete, una diferencia de 1077.76 tokens (43.3%). Las probabilidades de las preguntas compartidas se comparan en el anexo privado.

### Uso medido de R13 en etapas completadas

| Etapa completada | Resultados | Tokens de entrada | Tokens de salida | Uso tarifario |
|---|---:|---:|---:|---:|
| repair | 83962 | 47449091 | 3529017 | USD 2.033079 |
| interests | 83962 | 51983039 | 3190556 | USD 2.226360 |
| cost13 | 1000 | 2489144 | 305554 | USD 0.105042 |
| cost7 | 1000 | 1411381 | 199559 | USD 0.059774 |
| language-pt | 597 | 336042 | 25085 | USD 0.014394 |
| language-en | 597 | 316341 | 25091 | USD 0.013593 |
| translation | 98 | 10774 | 19526 | USD 0.325212 |
Los importes R13 son valores tarifarios del uso medido; no representan débitos de caja.
