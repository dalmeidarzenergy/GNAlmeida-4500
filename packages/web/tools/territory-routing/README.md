# Distâncias rodoviárias das freguesias

O CRM consulta `src/api/data/territory-road-distances.json` no servidor para calcular a coluna «KM», sem API externa, credenciais ou tarefas agendadas. Os valores em metros representam a distância do itinerário recomendado pelo perfil automóvel do OSRM (sem ferries, pode incluir portagens), desde a Rua do Mato, 1, 2000-531 Póvoa de Santarém, até um ponto viário de referência dentro da freguesia. Não são distâncias em linha reta, para uma morada na aldeia nem estimativas com trânsito em tempo real. A correspondência usa o distrito, o concelho e o nome oficial ou simplificado da freguesia (CAOP 2025). As regiões autónomas e destinos sem percurso apenas por estrada têm valor nulo, não zero.

## Atualizar o catálogo

As duas métricas partilham a resolução em `src/api/lib/territory-distance.ts`. A correspondência oficial tem prioridade sobre os nomes alternativos. Para o concelho da Covilhã, as designações históricas estão limitadas às uniões atuais confirmadas pelo [Anexo I da Lei n.º 11-A/2013](https://diariodarepublica.pt/dr/detalhe/lei/11-a-2013-373798) e pelo catálogo CAOP 2025. «Covilhã», como nome na coluna Freguesia ou no campo Localidade de Vendas, refere-se à união de Covilhã e Canhoso, não ao total do concelho. Não se distribuem as vendas das antigas uniões desagregadas pelas novas freguesias sem informação para as distinguir.

1. Descarregar e extrair os GeoPackages CAOP para Continente, RAA e RAM da [DGT](https://www.dgterritorio.gov.pt/atividades/cartografia/cartografia-tematica/caop).
2. Descarregar o extrato [`portugal-latest.osm.pbf`](https://download.geofabrik.de/europe/portugal/) da Geofabrik. Obter a data do mapa com `osmium fileinfo -g header.option.osmosis_replication_timestamp portugal.osm.pbf`.
3. Preparar e servir o grafo localmente com [OSRM](https://github.com/Project-OSRM/osrm-backend), usando o perfil `car.lua` da mesma versão (foi usada a v26.11.0). Não usar o servidor público para gerar o catálogo.

   ```sh
   osmium tags-filter portugal.osm.pbf w/highway=motorway,motorway_link,trunk,trunk_link,primary,primary_link,secondary,secondary_link,tertiary,tertiary_link,unclassified,residential,living_street,road r/type=restriction -o roads.osm.pbf
   osrm-extract -p /caminho/do/perfil/car.lua roads.osm.pbf
   osrm-contract roads.osrm
   osrm-routed --algorithm ch --ip 127.0.0.1 roads.osrm
   ```

   Usam-se as classes rodoviárias principais e locais, excluindo caminhos rurais e acessos de serviço como destinos de referência. O polígono CAOP é usado para confirmar que o ponto viário fica na freguesia correta.

   Se não houver memória para um único grafo (como no catálogo inicial), reduzir primeiro os IDs com `osmium renumber roads.osm.pbf -o dense.osm.pbf`. Extrair dois recortes com `osmium extract --strategy=complete_ways --bbox=… dense.osm.pbf -o região.osm.pbf`: `-9.65,36.9,-6.12,39.98` para o sul e `-9.65,38.96,-6.12,42.25` para o norte. Compilar cada grafo separadamente. Foi usado CH no sul, conforme os comandos acima, e MLD no norte: depois da extração, executar `osrm-partition north.osrm`, `osrm-customize north.osrm` e `osrm-routed --algorithm mld --ip 127.0.0.1 --port 4294 north.osrm`. Servir o sul noutra porta local e indicar os dois endereços com `--osrm` (sul) e `--north-osrm` (norte). A zona de sobreposição inclui a morada de partida em ambos os grafos. Se os primeiros pontos viários não tiverem rota, o gerador testa uma quadrícula dentro da freguesia antes de registar a distância como nula.

4. Com Python 3.10+ e `pip install pyproj shapely`, a partir da raiz do repo:

   ```sh
   python packages/web/tools/territory-routing/build-catalogue.py /caminho/da/caop/*.gpkg \
     --osm-snapshot AAAA-MM-DD --router-version v26.11.0
   ```

5. Rever as freguesias sem rota e incluir o JSON atualizado no build. A aplicação evita duplicações de dados: alterações à freguesia têm efeito imediato sem migração ou reimportação dos registos.
   Validar o catálogo e a correspondência com `bun test packages/web/tools/territory-routing/territory-distance.test.ts`.

**Fontes:** Informação geográfica cedida pela Direção-Geral do Território, CAOP 2025, [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), da qual foram extraídas as designações e calculados pontos dentro das fronteiras administrativas. Rede viária: [© contribuidores do OpenStreetMap](https://www.openstreetmap.org/copyright), ODbL 1.0, extrato da Geofabrik. Este catálogo inclui apenas designações administrativas e resultados de distâncias (não inclui o grafo).
