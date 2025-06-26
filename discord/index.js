const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const axios = require('axios');
const cheerio = require('cheerio');
const { token } = require('./config.json');

const fs = require('node:fs');

let localWordIndex = [];
try {
    const data = fs.readFileSync('./words.txt', 'utf8');
    localWordIndex = data.split(/\r?\n/).map(word => word.trim()).filter(word => word.length > 0);
    console.log(`Loaded ${localWordIndex.length} words from local index`);
} catch (err) {
    console.error('Error loading words from local index:', err);
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once('ready', () => {
    console.log(`Logged in as ${client.user.tag}`);
});

client.on('interactionCreate', async interaction => {
    if(interaction.isAutocomplete()) {
        const focusedOption = interaction.options.getFocused(true);
        if(focusedOption.name === 'slowo') {
            const query = focusedOption.value.toLowerCase();
            const filteredWords = localWordIndex.filter(word => word.toLowerCase().startsWith(query));

            const choices = filteredWords.slice(0, 25).map(word => ({
                name: word,
                value: word
            }));

            await interaction.respond(choices);
        }
    }

    if(!interaction.isCommand()) return;

    const { commandName } = interaction;
    if(commandName === 'slowo') {
        
        let ephemeral = interaction.options.getString('shhh') === 'true' ? true : false;

        await interaction.deferReply({ flags: ephemeral ? 64 : 0 });
        const wordToSearch = interaction.options.getString('slowo').replace(/ /g, '+');
        const sjpUrl = `https://sjp.pl/${encodeURIComponent(wordToSearch)}`;

        let sjpData = null;

        try {

            const { data } = await axios.get(sjpUrl);
            const $ = cheerio.load(data);

            if($('h1').text().includes('✕')) {
                sjpData = {
                    error: '404: The word was not found in the dictionary'
                }
                return;
            };

            const results = [];
            $('h1').each((i, h1) => {
                const element = $(h1);
                const title = element.text().trim();

                if (!title) return;

                const pAcceptable = element.next('p');
                const pLink = pAcceptable.next('p');
                const definitionP = pLink.nextAll('p[style*="font: medium/1.4 sans-serif"]').first();

                const acceptable = !pAcceptable.text().includes('niedopuszczalne');

                let declinable = null;
                let sourceDictionary = null;

                const detailsLink = pLink.find('a.lc').first();
                if (detailsLink.length) {
                    const onclickAttr = detailsLink.attr('onclick');
                    if (onclickAttr) {
                        const match = onclickAttr.match(/dopen\((\d+)/);
                        if (match && match[1]) {
                            const divId = `#d${match[1]}`;
                            $(divId).find('table.wtab tr').each((i, row) => {
                                const th = $(row).find('th[scope="row"]');
                                const thText = th.text().trim();
                                if (thText === 'odmienność') {
                                    declinable = $(row).find('td').text().trim() === 'tak';
                                } else if (thText === 'występowanie') {
                                    sourceDictionary = $(row).find('td').text().trim();
                                }
                            });
                        }
                    }
                }

                let meanings = [];
                const definitionHtml = definitionP.html();

                if (definitionHtml) {
                    let potentialMeanings = definitionHtml
                        .split('<br>')
                        .map(s => s.replace(/&nbsp;/g, ' ').trim())
                        .filter(Boolean);
                    let prefix = '';

                    if (potentialMeanings.length > 1 && potentialMeanings[0].endsWith(':')) {
                        prefix = potentialMeanings.shift() + ' ';
                    }

                    meanings = potentialMeanings.map(meaning => {
                        return (prefix + meaning.replace(/^[0-9]+\.\s*/, '')).trim();
                    });
                }

                if (meanings.length > 0) {
                    results.push({
                        word: title,
                        acceptable_in_games: acceptable,
                        declinable: declinable,
                        sourceDictionary: sourceDictionary,
                        meanings: meanings
                    });
                }
            });


            if(results.length > 0) {
                sjpData = results;
            } else {
                sjpData = {
                    error: '404: The word was not found in the dictionary'
                };
            }

        } catch (e) {
            console.error('Error fetching word definition:', e);
            
            const embed = [
                new EmbedBuilder()
                    .setColor(15277667)
                    .setTitle("❌  Nie znaleziono słowa")
                    .setDescription("Nie znaleziono słowa `" + wordToSearch +"` w słowniku sjp.pl :( "),
            ];
                
            await interaction.editReply({ embeds: embed });

            return;
        }

        if(sjpData.error) {
            const embed = [
                new EmbedBuilder()
                    .setColor(15277667)
                    .setTitle("❌  Nie znaleziono słowa")
                    .setDescription("Nie znaleziono słowa `" + wordToSearch +"` w słowniku sjp.pl :( "),
            ];

            await interaction.editReply({ embeds: embed });
            return;
        } else {
            const embeds = sjpData.map(def => {
                const meaningsList = def.meanings.map((m, idx) => `${idx + 1}. ${m}`).join('\n');
                return new EmbedBuilder()
                    .setTitle(`Definicja słowa: \`${def.word}\``)
                    .setColor(1752220)
                    .addFields(
                        {
                            name: "Dopuszczalne w grach słownych",
                            value: def.acceptable_in_games ? "✅ TAK" : "❌ NIE",
                            inline: true
                        },
                        {
                            name: "Odmienne przez przypadki",
                            value: def.declinable ? "✅ TAK" : "❌ NIE",
                            inline: true
                        },
                        {
                            name: "Słownik źródłowy",
                            value: def.sourceDictionary || "*Brak informacji*",
                            inline: false
                        },
                        {
                            name: " ",
                            value: meaningsList || "*Brak definicji*",
                            inline: false
                        }
                    )
            })

            await interaction.editReply({ embeds: embeds });
        }

    } else if(commandName === 'synonim') {
        let ephemeral = interaction.options.getString('shhh') === 'true' ? true : false;

        await interaction.deferReply({ flags: ephemeral ? 64 : 0 });
        const wordToSearch = interaction.options.getString('slowo');

        let thesaurusData = [];
        try {
            const thesaurusContent = fs.readFileSync('./thesaurus.txt', 'utf8');
            const thesaurusLines = thesaurusContent.split(/\r?\n/).map(line => line.trim()).filter(line => line.length > 0);
            thesaurusLines.forEach(line => {
                const [word, ...synonyms] = line.split(';').map(part => part.trim());
                if (word.toLowerCase() === wordToSearch.toLowerCase()) {
                    thesaurusData = synonyms.map(syn => syn.trim());
                }
            });

        } catch(e) {
            console.error('Error loading thesaurus data:', e);
            const embed = [
                new EmbedBuilder()
                    .setColor(15277667)
                    .setTitle("❌  Nie znaleziono słowa")
                    .setDescription("Nie znaleziono słowa `" + wordToSearch +"` w słowniku sjp.pl :( "),
            ];

            await interaction.editReply({ embeds: embed, ephemeral: true });
            return;
        }

        if(thesaurusData.length === 0) {
            const embed = [
                new EmbedBuilder()
                    .setColor(15277667)
                    .setTitle("❌  Nie znaleziono synonimów")
                    .setDescription("Nie znaleziono synonimów dla słowa `" + wordToSearch +"` w słowniku synonimów :( "),
            ];

            await interaction.editReply({ embeds: embed, ephemeral: true });
            return;
        } else {
            const embed = new EmbedBuilder()
                .setColor(1752220)
                .setTitle(`Synonimy słowa: \`${wordToSearch}\``)
                .setDescription(thesaurusData.join(', '));

            await interaction.editReply({ embeds: [embed] });
        }

    }

});

client.login(token);


// // Wczytaj synonimy z thesaurus.txt dla podanego wyrazu
//             let thesaurusData = [];
//             try {

//                 const thesaurusContent = fs.readFileSync('./thesaurus.txt', 'utf8');
//                 const thesaurusLines = thesaurusContent.split(/\r?\n/).map(line => line.trim()).filter(line => line.length > 0);
//                 thesaurusLines.forEach(line => {
//                     const [word, ...synonyms] = line.split(';').map(part => part.trim());
//                     if (word.toLowerCase() === wordToSearch.toLowerCase()) {
//                         thesaurusData = synonyms.map(syn => syn.trim());
//                     }
//                 });

//             } catch(e) {
//                 console.error('Error loading thesaurus data:', e);
//                 const embed = [
//                     new EmbedBuilder()
//                         .setColor(15277667)
//                         .setTitle("❌  Nie znaleziono słowa")
//                         .setDescription("Nie znaleziono słowa `" + wordToSearch +"` w słowniku sjp.pl :( "),
//                 ];

//                 await interaction.editReply({ embeds: embed, ephemeral: true });
//                 return;

//             }