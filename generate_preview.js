const fs = require('fs');
const path = require('path');

try {
    const imgPath = path.join(__dirname, '0 (1).png');
    const img = fs.readFileSync(imgPath).toString('base64');
    const base64Data = 'data:image/png;base64,' + img;

    const html = `<!DOCTYPE html>
<html lang="pt-br">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Preview de Recorte Casulo - 6 Opções</title>
    <style>
        body { font-family: sans-serif; background: #f4f4f4; padding: 20px; display: flex; flex-direction: column; align-items: center; }
        .container { display: flex; gap: 20px; flex-wrap: wrap; justify-content: center; }
        .card { background: white; padding: 15px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); text-align: center; width: 430px; margin-bottom: 20px; }
        .image-box { border: 2px dashed #ccc; background: #fff; position: relative; width: 400px; height: 400px; margin: 0 auto; overflow: hidden; }
        .label { margin-top: 15px; font-weight: bold; color: #111; font-size: 16px; }
        .desc { font-size: 13px; color: #666; margin-top: 5px; height: 40px; }
        img { display: block; }
        .img-original { max-width: 100%; height: auto; border: 1px solid #ddd; object-fit: contain; }
        .img-contain { width: 100%; height: 100%; object-fit: contain; }
        .img-scale-14 { width: 100%; height: 100%; object-fit: contain; transform: scale(1.4); }
        .img-scale-18 { width: 100%; height: 100%; object-fit: contain; transform: scale(1.8); }
        .img-scale-22 { width: 100%; height: 100%; object-fit: contain; transform: scale(2.2); }
        .img-custom-crop { width: 150%; height: auto; position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); }
    </style>
</head>
<body>
    <h1>Estudo de Enquadramento 800x800</h1>
    <p>Escolha o nível de zoom que melhor valoriza o produto no PDF.</p>
    <div class="container">
        <div class="card">
            <div class="image-box" style="border:none; overflow:visible;"><img src="${base64Data}" class="img-original"></div>
            <div class="label">1. Imagem Original</div>
            <div class="desc">Como a imagem vem (muito respiro lateral).</div>
        </div>
        <div class="card">
            <div class="image-box"><img src="${base64Data}" class="img-contain"></div>
            <div class="label">2. 800x800 (Ajustar)</div>
            <div class="desc">Mantém o vazio original mas padroniza o quadrado.</div>
        </div>
        <div class="card">
            <div class="image-box"><img src="${base64Data}" class="img-scale-14"></div>
            <div class="label">3. Zoom 1.4x</div>
            <div class="desc">Recorte moderado para destaque.</div>
        </div>
        <div class="card">
            <div class="image-box"><img src="${base64Data}" class="img-scale-18"></div>
            <div class="label">4. Zoom 1.8x</div>
            <div class="desc">Foco alto, bordas mínimas.</div>
        </div>
        <div class="card">
            <div class="image-box"><img src="${base64Data}" class="img-scale-22"></div>
            <div class="label">5. Super Zoom (2.2x)</div>
            <div class="desc">Ocupação máxima do quadrado.</div>
        </div>
        <div class="card">
            <div class="image-box"><img src="${base64Data}" class="img-custom-crop"></div>
            <div class="label">6. Recorte Lateral (150%)</div>
            <div class="desc">Largura esticada para preencher laterais.</div>
        </div>
    </div>
</body>
</html>`;

    fs.writeFileSync(path.join(__dirname, 'preview_crop.html'), html);
    console.log('HTML gerado com sucesso em preview_crop.html');
} catch (err) {
    console.error('Erro ao gerar HTML:', err);
    process.exit(1);
}
